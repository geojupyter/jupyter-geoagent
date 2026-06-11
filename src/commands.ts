/**
 * Register one JupyterLab command per geo-agent map tool.
 *
 * Wiring:
 *   app.commands.addCommand('geoagent:<tool_name>', { execute, describedBy })
 *     → jupyter-ai persona calls execute_command (via jupyter_server_mcp MCP tool)
 *     → jupyterlab_commands_toolkit emits a jupyterlab-command/v1 event
 *     → the frontend event listener calls app.commands.execute('geoagent:<tool_name>', args)
 *     → this handler looks up the active panel and dispatches through createMapTools()
 *
 * Call this once at plugin activation. Commands stay registered for the
 * lifetime of the JupyterLab session; they error clearly if no panel is open.
 */

import { JupyterFrontEnd } from '@jupyterlab/application';
import { createMapTools } from 'geo-agent/app/map-tools.js';
import { MapManagerAdapter } from './core/map-manager-adapter';
import { getActivePanel } from './core/active-panel';
import { assetToMapLayerConfig, extractColumns, MCPCollection } from './core/mcp-catalog';

/** Skip tools that depend on machinery jupyter-geoagent doesn't provide yet. */
const SKIP_TOOLS = new Set([
  'list_datasets',          // needs DatasetCatalog; jupyter-geoagent uses MCP-backed catalog
  'get_schema',             // same — delegates to catalog.get(dataset_id)
  'set_projection',         // MapViewController doesn't implement globe/mercator toggle
]);

const NO_PANEL_ERROR = JSON.stringify({
  success: false,
  error: 'No GeoAgent Map panel is open. Ask the user to open one from the JupyterLab launcher (File → New → GeoAgent Map).',
});

export function registerGeoAgentCommands(app: JupyterFrontEnd): void {
  // Build the tool list once using stubs — we only use each entry's name,
  // description, and inputSchema here. Real mapManager/catalog/mcpClient are
  // resolved inside each execute handler from getActivePanel().
  const stubManager = {
    getLayerIds: () => [],
    getVectorLayerIds: () => [],
    getLayerSummaries: () => [],
  };
  const stubCatalog = { getAll: () => [], get: () => null, getIds: () => [] };
  const stubMcp = {};
  const toolMetadata = createMapTools(stubManager as any, stubCatalog as any, stubMcp as any);

  for (const meta of toolMetadata) {
    if (SKIP_TOOLS.has(meta.name)) continue;

    const commandId = `geoagent:${meta.name}`;

    app.commands.addCommand(commandId, {
      label: `GeoAgent: ${meta.name}`,
      caption: firstLine(meta.description),
      // `usage` is what jupyterlab_commands_toolkit surfaces as `description`
      // in list_all_commands output, so the LLM sees the full tool description
      // (including nudges like "IMPORTANT: check featuresInView" and available
      // layer lists), not just the one-line caption.
      usage: meta.description,
      describedBy: { args: meta.inputSchema },
      execute: async (args) => {
        const panel = getActivePanel();
        if (!panel) return NO_PANEL_ERROR;
        const argsObj = (args ?? {}) as Record<string, any>;

        const adapter = new MapManagerAdapter(panel.controller, { onChange: panel.refresh });
        // Rebuild the tool with the real adapter + mcpClient so closures bind
        // to the current panel's state.
        const tools = createMapTools(adapter as any, stubCatalog as any, panel.mcpClient ?? undefined);
        const tool = tools.find(t => t.name === meta.name);
        if (!tool) {
          // map-tools.js only includes filter_by_query when mcpClient is truthy,
          // so a missing tool here usually means the panel has no MCP connection.
          if (meta.name === 'filter_by_query' && !panel.mcpClient) {
            return recordAndReturn(panel, meta.name, argsObj,
              { success: false, error: 'filter_by_query requires an MCP connection. Connect to the MCP server in the Query tab first.' });
          }
          return recordAndReturn(panel, meta.name, argsObj,
            { success: false, error: `Tool '${meta.name}' not found in createMapTools output.` });
        }

        try {
          const result = await Promise.resolve(tool.execute(argsObj));
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          panel.recorder.record(meta.name, argsObj, resultStr);
          return resultStr;
        } catch (err: any) {
          return recordAndReturn(panel, meta.name, argsObj,
            { success: false, error: err?.message ?? String(err) });
        }
      },
    });
  }

  registerAddLayerCommand(app);
  registerMcpReadCommands(app);
}

/**
 * Register `geoagent:*` commands that pass through to the NRP MCP server's
 * read-only tools (browse_stac_catalog, get_stac_details, get_collection, query).
 *
 * The panel's MCPClientWrapper owns the actual MCP connection (and the CORS-safe
 * proxy path through the Jupyter server extension); these commands just forward
 * args and return the tool's text result. That keeps a single MCP client in
 * the system — Claude/jupyter-ai reaches NRP only via the panel, never directly.
 *
 * Hardcoded names + schemas because JupyterLab commands must be registered at
 * activation time so `list_all_commands` can surface them to the LLM regardless
 * of whether a panel is open yet. The `usage` strings are intentionally short:
 * the upstream MCP tool descriptions ship far more detail (especially `query`'s
 * SQL/H3 rules), and the LLM gets the full text back as part of each call's
 * result. CLAUDE.md should orient the agent to that fact.
 */
function registerMcpReadCommands(app: JupyterFrontEnd): void {
  registerMcpPassthrough(app, 'browse_stac_catalog', {
    caption: 'Browse the STAC catalog to discover available datasets.',
    usage: `Browse the public STAC catalog to list available collection IDs and titles. Use this first when the user asks about data outside the layers already on the map. Returns markdown.

Pair with geoagent:get_stac_details (markdown for SQL prep) or geoagent:get_collection (structured JSON for add_layer).

Optional parameters:
- catalog_url: alternate STAC catalog URL
- catalog_token: Bearer token for private catalogs`,
    args: {
      type: 'object',
      properties: {
        catalog_url: { type: 'string', description: 'Optional alternate STAC catalog URL' },
        catalog_token: { type: 'string', description: 'Optional Bearer token for private catalogs' },
      },
    },
  });

  registerMcpPassthrough(app, 'get_stac_details', {
    caption: 'Fetch markdown metadata (parquet paths, column schemas, query rules) for a STAC collection.',
    usage: `Markdown metadata for a STAC collection — parquet S3 paths, column schemas, and dataset-specific guidance (DISTINCT requirements, aggregation rules). This is the right read tool when you plan to write SQL against the dataset.

ALWAYS call this before geoagent:query — copy parquet paths from this output verbatim into read_parquet(); never guess paths.

Use geoagent:get_collection instead if you need machine-readable JSON to drive geoagent:add_layer.

Required:
- dataset_id: STAC collection ID (e.g. 'wdpa', 'fire-perimeters')

Optional:
- catalog_url, catalog_token`,
    args: {
      type: 'object',
      properties: {
        dataset_id: { type: 'string', description: 'STAC collection ID' },
        catalog_url: { type: 'string' },
        catalog_token: { type: 'string' },
      },
      required: ['dataset_id'],
    },
  });

  registerMcpPassthrough(app, 'get_collection', {
    caption: 'Fetch structured JSON metadata for a STAC collection (assets, extent, columns).',
    usage: `Structured JSON metadata for a STAC collection — assets (PMTiles, COG, parquet), per-asset STAC extension fields (table:columns, raster:bands, vector:layers), spatial extent, child collection IDs, S3 paths pre-resolved.

Use this when you need machine-readable metadata to drive geoagent:add_layer (you need an asset_id from this output). For markdown summaries aimed at human/LLM reading, prefer geoagent:get_stac_details.

Required:
- collection_id: STAC collection ID

Optional:
- catalog_url, catalog_token`,
    args: {
      type: 'object',
      properties: {
        collection_id: { type: 'string', description: 'STAC collection ID' },
        catalog_url: { type: 'string' },
        catalog_token: { type: 'string' },
      },
      required: ['collection_id'],
    },
  });

  registerMcpPassthrough(app, 'query', {
    caption: 'Run a DuckDB SQL query over S3 parquet files referenced by the STAC catalog.',
    usage: `Run DuckDB SQL against S3 parquet files referenced by the STAC catalog. The full upstream tool response includes detailed query-optimization rules (h0 partition pruning, hex resolution joins, raster-vs-vector aggregation, area-from-hex counts) — getting those wrong on hex data can be off by 1000x. Read the rules in the response and follow them.

CRITICAL: There are no tables. Every FROM must be read_parquet('s3://...'). NEVER guess paths. Always call geoagent:browse_stac_catalog and geoagent:get_stac_details first, then copy paths verbatim.

Required:
- sql_query: full SQL string

Optional (private data):
- s3_key, s3_secret, s3_endpoint, s3_scope`,
    args: {
      type: 'object',
      properties: {
        sql_query: { type: 'string' },
        s3_key: { type: 'string' },
        s3_secret: { type: 'string' },
        s3_endpoint: { type: 'string' },
        s3_scope: { type: 'string' },
      },
      required: ['sql_query'],
    },
  });

  registerMcpPassthrough(app, 'register_hex_tiles', {
    caption: 'Materialize an H3 hex pyramid to object storage and return a MapLibre vector tile URL.',
    usage: `Materialize a partitioned H3 hex pyramid to public object storage and return a MapLibre vector tile URL template, bounds, value columns, and per-resolution value stats.

WHEN TO USE — only when the user explicitly asks for an aggregate density / heatmap / hex-grid visualization over a region. Trigger phrases: "hex map", "density map", "heatmap", "show density of X", "aggregate X by hex".

Pair with geoagent:add_hex_tile_layer — pass tile_url_template → tile_url, value_columns → pick one as value_column, value_stats[value_column] → value_stats, bounds → bounds, layer_name → layer_name.

For most map/data questions, use geoagent:query instead. Do NOT use this tool for counts/lookups, navigating the map, or styling an existing catalog layer.

Required:
- sql: SELECT whose first column is an H3 index

Optional:
- agg (default "COUNT"), min_res (default 2), finest_res (inferred from sql), zoom_offset (default -1)`,
    args: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT whose first column is an H3 index' },
        agg: { type: 'string', description: 'Aggregation applied at coarser pyramid levels (default COUNT)' },
        min_res: { type: 'integer', description: 'Coarsest H3 resolution in the pyramid (default 2)' },
        finest_res: { type: 'integer', description: 'Optional override; inferred from sql when omitted' },
        zoom_offset: { type: 'integer', description: 'Maps map zoom to H3 resolution (default -1)' },
      },
      required: ['sql'],
    },
  });
}

function registerMcpPassthrough(
  app: JupyterFrontEnd,
  toolName: string,
  meta: { caption: string; usage: string; args: any },
): void {
  app.commands.addCommand(`geoagent:${toolName}`, {
    label: `GeoAgent: ${toolName}`,
    caption: meta.caption,
    usage: meta.usage,
    describedBy: { args: meta.args },
    execute: async (args) => {
      const panel = getActivePanel();
      if (!panel) return NO_PANEL_ERROR;
      const argsObj = (args ?? {}) as Record<string, any>;
      if (!panel.mcpClient) {
        return recordAndReturn(panel, toolName, argsObj,
          { success: false, error: `${toolName} requires the panel's MCP connection, which is not connected. Check the Query tab.` });
      }
      try {
        const result = await panel.mcpClient.callTool(toolName, argsObj);
        panel.recorder.record(toolName, argsObj, result);
        return result;
      } catch (err: any) {
        return recordAndReturn(panel, toolName, argsObj,
          { success: false, error: err?.message ?? String(err) });
      }
    },
  });
}

/**
 * `geoagent:add_layer` — jupyter-geoagent-specific command (not part of the
 * geo-agent tool set). Fetches a STAC asset via MCP `get_collection` and adds
 * it to the map as a live PMTiles/COG layer, equivalent to clicking
 * "Add to Map" in the catalog browser.
 *
 * Needed because geo-agent web apps have their layers pre-configured at
 * deploy time, but in jupyter-geoagent the user expects to compose the map
 * interactively — so the LLM needs an addable-layer path too.
 */
function registerAddLayerCommand(app: JupyterFrontEnd): void {
  app.commands.addCommand('geoagent:add_layer', {
    label: 'GeoAgent: add_layer',
    caption: 'Add a STAC asset (PMTiles or COG) to the map as a live interactive layer, optionally with a default style/filter.',
    usage: `Add a STAC asset from the configured catalog as a live interactive map layer (PMTiles vector or COG raster). This is the correct way to bring a dataset onto the map when the user asks you to "add X" or "show X" — do NOT write config files, export GeoJSON, or otherwise materialize the data client-side.

Workflow:
1. Use browse_stac_catalog (MCP) to find a collection_id.
2. Use get_collection (MCP) to see which assets are available — PMTiles assets typically have href ending in .pmtiles, COG raster assets have href ending in .tif / .tiff.
3. Call this command with the collection_id and asset_id, plus any of the optional style/filter overrides. The command returns the layer_id you can use in subsequent set_filter / set_style / filter_by_query / show_layer / hide_layer calls.

After adding, the map flies to the collection's extent and the layer is visible.

Required parameters:
- collection_id: the STAC collection ID (e.g., 'fire-perimeters')
- asset_id: the visual asset key inside the collection (e.g., 'firep-pmtiles')

Optional parameters (mirror the layers-input.json schema so you can compose a full styled layer in a single call):
- title: display name for the Layers panel (defaults to the STAC asset title)
- source_layer: PMTiles source-layer name (defaults to the asset's first 'vector:layers' entry, falling back to collection_id)
- default_style: MapLibre paint properties for the fill/raster layer, e.g. {"fill-color": "#FF6B35", "fill-opacity": 0.5}
- outline_style: MapLibre paint properties for the polygon outline line, e.g. {"line-color": "#D32F2F", "line-width": 1}. Only meaningful for vector polygon layers; ignored otherwise.
- default_filter: MapLibre filter expression applied on load, e.g. [">=", ["get", "YEAR_"], 2000]. Use the modern expression form ["==", ["get", "PROP"], VAL], not legacy ["==", "PROP", VAL].`,
    describedBy: {
      args: {
        type: 'object',
        properties: {
          collection_id: { type: 'string', description: 'STAC collection ID' },
          asset_id: { type: 'string', description: 'Visual asset key (PMTiles vector or COG raster)' },
          title: { type: 'string', description: 'Display name shown in the Layers panel (defaults to the asset title)' },
          source_layer: { type: 'string', description: 'PMTiles source-layer name; defaults to the asset\'s first vector:layers entry' },
          default_style: { type: 'object', description: 'MapLibre paint properties for the fill/raster layer' },
          outline_style: { type: 'object', description: 'MapLibre paint properties for the polygon outline line layer (vector polygons only)' },
          default_filter: { type: 'array', description: 'MapLibre filter expression applied on load' },
        },
        required: ['collection_id', 'asset_id'],
      },
    },
    execute: async (args) => {
      const panel = getActivePanel();
      if (!panel) return NO_PANEL_ERROR;
      const argsObj = (args ?? {}) as Record<string, any>;

      if (!panel.mcpClient) {
        return recordAndReturn(panel, 'add_layer', argsObj,
          { success: false, error: 'add_layer requires an MCP connection. Connect to the MCP server in the Query tab first.' });
      }

      const collectionId = argsObj.collection_id;
      const assetId = argsObj.asset_id;
      if (!collectionId || !assetId) {
        return recordAndReturn(panel, 'add_layer', argsObj,
          { success: false, error: 'Both collection_id and asset_id are required.' });
      }

      let parsed: MCPCollection;
      try {
        const raw = await panel.mcpClient.callTool('get_collection', { collection_id: collectionId });
        parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw as MCPCollection);
      } catch (err: any) {
        return recordAndReturn(panel, 'add_layer', argsObj,
          { success: false, error: `Failed to fetch collection '${collectionId}': ${err?.message ?? String(err)}` });
      }
      if ((parsed as any).error) {
        return recordAndReturn(panel, 'add_layer', argsObj,
          { success: false, error: `Collection '${collectionId}' not found: ${(parsed as any).error}` });
      }

      const asset = parsed.assets?.[assetId];
      if (!asset) {
        const available = Object.keys(parsed.assets || {}).join(', ') || '(none)';
        return recordAndReturn(panel, 'add_layer', argsObj,
          { success: false, error: `Asset '${assetId}' not found in collection '${collectionId}'. Available assets: ${available}` });
      }

      const config = assetToMapLayerConfig(collectionId, assetId, asset, panel.s3Endpoint, panel.titilerUrl);
      if (!config) {
        return recordAndReturn(panel, 'add_layer', argsObj,
          { success: false, error: `Asset '${assetId}' is not a visual type. add_layer only supports PMTiles (vector) or COG (raster) assets.` });
      }

      // Merge LLM-supplied overrides into the config before addLayer.
      // Matches the layers-input.json schema so the LLM can compose a
      // fully-styled layer in one call.
      if (typeof argsObj.title === 'string') config.title = argsObj.title;
      if (typeof argsObj.source_layer === 'string') config.sourceLayer = argsObj.source_layer;
      if (argsObj.default_style && typeof argsObj.default_style === 'object') config.defaultStyle = argsObj.default_style;
      if (argsObj.outline_style && typeof argsObj.outline_style === 'object') config.outlineStyle = argsObj.outline_style;
      if (Array.isArray(argsObj.default_filter)) config.defaultFilter = argsObj.default_filter;

      const columns = extractColumns(parsed);
      const layerId = panel.controller.addLayer(collectionId, config, columns);
      panel.controller.showLayer(layerId);

      // Fly to the collection's extent so the user immediately sees it.
      const bbox = parsed.extent?.spatial?.bbox?.[0];
      if (bbox) {
        const [west, south, east, north] = bbox;
        panel.controller.flyTo([(west + east) / 2, (south + north) / 2]);
      }

      panel.refresh();
      return recordAndReturn(panel, 'add_layer', argsObj,
        { success: true, layer_id: layerId, ...(bbox ? { bbox } : {}) });
    },
  });
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.slice(0, idx);
}

function recordAndReturn(
  panel: NonNullable<ReturnType<typeof getActivePanel>>,
  toolName: string,
  args: Record<string, any>,
  result: unknown,
): string {
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
  panel.recorder.record(toolName, args, resultStr);
  return resultStr;
}
