# jupyter-geoagent: Design Specification

**Date:** 2026-04-14
**Repo:** `geojupyter/jupyter-geoagent`

:::{note}
This is an internal architecture reference for contributors. If you are looking for how to use the extension, see the [Usage Guide](usage.md) instead.
:::

## Problem

Geo-agent web apps require hand-authoring a `layers-input.json` config file, writing an `index.html`, and deploying to a URL. This creates friction for researchers who want to explore STAC catalog data, compose maps, and run spatial queries without writing code or managing infrastructure. The target user is someone accustomed to ArcGIS-style GIS workflows — they expect to click, not code.

## Solution

A JupyterLab extension that provides a GUI-first, no-code map exploration experience powered by the same core modules as geo-agent. Users click "GeoAgent Map" in the JupyterLab launcher and get a fully interactive environment: browse STAC catalogs, add layers, style and filter data, run DuckDB queries via MCP, and export reproducible artifacts.

By living inside Jupyter, the extension sidesteps deployment friction (JupyterHub provides the URL and auth), while enabling future integration with jupyter-ai for LLM-driven workflows.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    JupyterLab Frontend                       │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Catalog     │  │   MapLibre   │  │   Layer Panel     │  │
│  │   Browser     │  │   Map View   │  │   + Query Panel   │  │
│  │   (sidebar)   │  │   (center)   │  │   + Export Panel  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                    │              │
│         └────────────┬────┴────────────────────┘              │
│                      │                                        │
│              ┌───────▼────────┐                               │
│              │  ToolRegistry  │──── ToolCallRecorder           │
│              └───────┬────────┘                               │
│                      │                                        │
│         ┌────────────┼────────────┐                           │
│         │            │            │                           │
│    ┌────▼───┐  ┌─────▼────┐  ┌───▼──────┐                   │
│    │  Map   │  │ Dataset   │  │   MCP    │                   │
│    │ Tools  │  │ Catalog   │  │  Client  │                   │
│    │(local) │  │  (STAC)   │  │          │                   │
│    └────────┘  └──────────┘  └───┬──────┘                   │
│                                   │                           │
└───────────────────────────────────┼───────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
              │  Remote    │  │  Jupyter   │  │  Local    │
              │  MCP       │  │  Server    │  │  MCP      │
              │  Server    │  │  Proxy     │  │  Server   │
              └───────────┘  └───────────┘  └───────────┘
```

### Geo-agent Module Reuse

The extension uses geo-agent as a peer — sharing the same MCP server and STAC catalog, but implementing its own catalog browsing logic locally rather than re-using geo-agent's `DatasetCatalog`.

| Module | Status | Notes |
|--------|--------|-------|
| `MCPClient` | Used | Wrapped in `src/core/mcp.ts`; may route through server proxy |
| `createMapTools()` | Used | Tool metadata extraction for query/filter UI |
| `MapManager` (via `MapView.tsx`) | Used | Wrapped in React component |
| `ToolRegistry` | Used | Plus `ToolCallRecorder` hook |
| `DatasetCatalog` | **Not used** | Replaced by `src/core/mcp-catalog.ts` — pure functions that fetch from the STAC root and call MCP `get_collection` directly |
| `Agent` / `ChatUI` | Not used | LLM loop delegated to jupyter-ai Claude persona |

`MapLayerConfig` and `ColumnInfo` are defined locally in `src/core/types.ts` rather than re-exported from geo-agent, so the extension can evolve its type surface independently.

## User Experience

### Entry Point

User clicks **"GeoAgent Map"** in the JupyterLab launcher (or `File > New > GeoAgent Map`). A new main-area panel opens.

### Panel Layout

**Left sidebar — Catalog Browser:**
- URL field for STAC catalog (pre-filled with configurable default)
- "Load" button fetches catalog and lists collections
- Each collection: title, description, thumbnail, "Add to Map" button
- Expandable per-collection to see individual assets
- Search/filter field to narrow collections by keyword

**Center — Map:**
- Full MapLibre GL JS map with standard controls (zoom, rotate, geolocate)
- Basemap switcher (natgeo / satellite / plain / custom)
- Globe/mercator projection toggle
- Layers render as added from catalog browser

**Right sidebar — Tabbed Panel:**

*Layers tab:*
- Ordered list of active layers
- Per layer: visibility toggle, opacity slider, remove button
- Expandable per layer: style controls (fill color, line width, etc.), filter builder (dropdown of properties → operator → value)
- Drag to reorder
- For versioned assets: dropdown to switch versions

*Query tab:*
- Dataset selector dropdown (populated from added layers that have parquet assets)
- SQL editor (text area with syntax highlighting)
- "Run Query" button → dispatches to MCP `query` tool
- Results displayed as a table below the editor
- Option to "Apply as Filter" to push query results back to the map

*Export tab:*
- **Export Static Map** → downloads self-contained HTML file with MapLibre + inlined layer configs
- **Export Config** → downloads `layers-input.json` compatible with geo-agent web app deployment
- **Export Tool Log** → downloads JSON array of all tool calls made during the session (replayable, reproducible)
- **Copy Tool Log** → copies to clipboard

### No-Code Guarantee

Every interaction is click-driven. The user never sees Python, JavaScript, or JSON unless they choose to export it. The notebook is not involved.

## Tool Call Recording

Every GUI action maps to a named tool call, identical to what the LLM would produce in a geo-agent web app. A `ToolCallRecorder` wraps the `ToolRegistry` and intercepts every `execute()` call:

```typescript
interface RecordedToolCall {
  id: number;           // sequential
  tool: string;         // tool name (e.g. "show_layer")
  args: object;         // tool arguments
  result?: any;         // tool return value (optional, for queries)
  timestamp: string;    // ISO 8601
}
```

The recorder is append-only during a session. The export tab exposes it in two formats:

1. **Tool call log (JSON)** — array of `RecordedToolCall`, directly replayable
2. **layers-input.json** — snapshot of current map state (catalog URL, collections, per-layer visibility/style/filter, view position), which captures the *end state* rather than the journey

The tool call log is the "reproducible notebook" equivalent for this GUI — it captures exactly what was done, in order, with arguments.

## MCP Integration

### Remote MCP (default)

The frontend MCPClient connects directly to a remote MCP server URL (e.g. `https://duckdb-mcp.nrp-nautilus.io/mcp`), same as geo-agent web apps.

### Server Proxy

For JupyterHub environments that restrict outbound browser connections, the server extension exposes a proxy endpoint:

```
POST /jupyter-geoagent/mcp-proxy
Body: { "server_url": "https://...", "method": "tools/call", "params": {...} }
```

The frontend detects connectivity and falls back to the proxy automatically.

### Local MCP

The server extension can optionally manage a local DuckDB MCP server process for querying the user's own data. Configuration via JupyterLab settings or environment variables.

## jupyter-ai Command Bridge

The LLM chat panel drives the map through a short chain of pre-existing JupyterLab machinery:

```
 jupyter-ai persona (Claude / OpenCode / Goose)
   │  (MCP tool call: execute_command)
   ▼
 jupyter_server_mcp  ──── discovers tools via the
                          `jupyter_server_mcp.tools` entrypoint
   │
   ▼
 jupyterlab_commands_toolkit  ── emits a `jupyterlab-command/v1` event
   │
   ▼
 jupyterlab-eventlistener (browser)
   │
   ▼
 app.commands.execute('geoagent:<tool>', args)
   │
   ▼
 src/commands.ts handler
   │  constructs MapManagerAdapter(controller, {onChange: refresh})
   │  calls geo-agent's createMapTools(adapter, stubCatalog, mcpClient)
   ▼
 MapViewController  → map mutations  + ToolCallRecorder entry
```

Key pieces:

- **`src/commands.ts`** — at plugin activation, loops over `createMapTools()` output and registers one JupyterLab command (`geoagent:<tool_name>`) per tool, setting `describedBy.args` to the tool's `inputSchema` and `usage` to the full multi-paragraph description (so the LLM sees the nudges, not just the first line). Then registers `geoagent:add_layer` — jupyter-specific, not part of geo-agent's tool set — which fetches a STAC asset via MCP `get_collection` and adds it to the map. `add_layer`'s arg schema mirrors the `layers-input.json` entry shape (`collection_id`, `asset_id`, plus optional `title`, `source_layer`, `default_style`, `outline_style`, `default_filter`) so the LLM can compose a styled, filtered layer in one call — bridging the gap between geo-agent's pre-configured-at-deploy-time model and jupyter-geoagent's interactive-composition expectation.
- **`src/core/active-panel.ts`** — module-scoped ref `{controller, mcpClient, recorder, refresh}` that `GeoAgentApp` updates on mount and clears on unmount. Multi-panel UX is last-mounted-wins (ArcGIS "active frame" idiom).
- **`src/core/map-manager-adapter.ts`** — `MapManagerAdapter` wraps `MapViewController` with the `MapManager` surface geo-agent expects (`{success, ...}` return shapes, `getLayerSummaries`, `syncCheckbox`). Every mutation fires `options.onChange`, which bumps the React `layerRefreshKey` so the *Layers* panel re-renders in response to LLM-driven changes.

What this enables: zero prompt-engineering per app. Any jupyter-ai persona with MCP access sees the commands via `list_all_commands` and can drive the map directly. Tools added upstream in `boettiger-lab/geo-agent` appear automatically after a `jlpm install` + rebuild — no per-command wiring in jupyter-geoagent.

Tools currently skipped from the createMapTools-derived set (in `SKIP_TOOLS`): `list_datasets` and `get_schema` (require geo-agent's sync `DatasetCatalog`; jupyter-geoagent uses an MCP-backed catalog instead, and the LLM can reach MCP catalog tools directly), and `set_projection` (no globe/mercator toggle in `MapViewController` yet).

## Server Extension

Lightweight Python package (`jupyter_geoagent`) registered as a Jupyter server extension:

- **MCP proxy handler** — relays MCP requests from frontend to remote servers (bypasses CORS / network restrictions)
- **Local MCP management** — spawn/stop a local DuckDB MCP server, configure its data paths
- **Configuration** — traitlets-based config for default catalog URLs, MCP server list, etc.

No custom document type, no yjs/CRDT, no collaboration features in v1.

## Package Structure

```
jupyter-geoagent/
├── package.json              # TypeScript deps, build scripts, JupyterLab extension metadata
├── pyproject.toml            # Python package + server extension + build config
├── tsconfig.json
├── webpack.config.js         # or a JupyterLab federated extension setup
├── README.md
├── LICENSE
│
├── src/                      # TypeScript frontend (JupyterLab extension)
│   ├── index.ts              # Plugin registration (launcher, commands, panels)
│   ├── panel.ts              # Main GeoAgent panel (Lumino MainAreaWidget)
│   ├── components/           # React components
│   │   ├── MapView.tsx       # MapLibre GL JS wrapper
│   │   ├── CatalogBrowser.tsx
│   │   ├── LayerPanel.tsx
│   │   ├── QueryPanel.tsx
│   │   └── ExportPanel.tsx
│   ├── core/                 # Wrappers around geo-agent modules
│   │   ├── types.ts          # TypeScript interfaces for geo-agent module APIs
│   │   ├── catalog.ts        # DatasetCatalog wrapper
│   │   ├── map.ts            # MapManager wrapper
│   │   ├── tools.ts          # ToolRegistry + ToolCallRecorder
│   │   └── mcp.ts            # MCPClient wrapper (with proxy fallback)
│   └── style/
│       └── index.css
│
├── jupyter_geoagent/         # Python server extension
│   ├── __init__.py           # Extension registration
│   ├── handlers.py           # MCP proxy handler
│   └── config.py             # Configurable traits
│
├── style/                    # JupyterLab CSS integration
│   └── base.css
│
└── docs/
    └── design.md             # This file
```

## Configuration

JupyterLab settings schema (`schema/plugin.json`):

```json
{
  "jupyter-geoagent:settings": {
    "type": "object",
    "properties": {
      "defaultCatalogUrl": {
        "type": "string",
        "default": "https://s3-west.nrp-nautilus.io/public-data/stac/catalog.json",
        "description": "Default STAC catalog URL loaded when opening a new map"
      },
      "defaultTitilerUrl": {
        "type": "string",
        "default": "https://titiler.nrp-nautilus.io",
        "description": "Default TiTiler endpoint for COG rendering"
      },
      "mcpServers": {
        "type": "array",
        "default": [
          {"name": "NRP DuckDB", "url": "https://duckdb-mcp.nrp-nautilus.io/mcp", "type": "remote"}
        ],
        "description": "Available MCP servers"
      },
      "defaultBasemap": {
        "type": "string",
        "enum": ["natgeo", "satellite", "plain"],
        "default": "natgeo"
      },
      "useProxy": {
        "type": "string",
        "enum": ["auto", "always", "never"],
        "default": "auto",
        "description": "Whether to route MCP requests through the server proxy"
      }
    }
  }
}
```

## Export Formats

### Static HTML Map

A self-contained HTML file that can be opened in any browser:
- Inlines MapLibre GL JS + PMTiles from CDN
- Inlines all layer configurations (sources, styles, filters)
- Inlines the current view state (center, zoom, bearing, pitch)
- PMTiles layers reference their original URLs (these are public)
- COG layers reference TiTiler tile URLs
- No server dependency — works offline for vector layers, needs network for raster tiles

### layers-input.json

The standard geo-agent configuration format. A user can take this file, pair it with the [geo-agent-template](https://github.com/boettiger-lab/geo-agent-template), and deploy a full geo-agent web app with LLM chat.

### Standalone App (layers-input.json + index.html)

The **Export Standalone App** button downloads both files together. `index.html` loads geo-agent from the jsDelivr CDN (`cdn.jsdelivr.net/gh/boettiger-lab/geo-agent@main/app/main.js`), which reads `layers-input.json` at startup and renders the full map with all configured layers. Place both files in the same directory, serve over HTTP, and the app works without any additional setup.

### Tool Call Log (JSON)

```json
{
  "version": "1.0",
  "catalog": "https://...",
  "created": "2026-04-14T...",
  "calls": [
    {"id": 1, "tool": "show_layer", "args": {"layer_id": "cpad-holdings"}, "timestamp": "..."},
    {"id": 2, "tool": "set_filter", "args": {"layer_id": "cpad-holdings", "filter": ["==", ["get", "MNG_AGENCY"], "State Parks"]}, "timestamp": "..."},
    {"id": 3, "tool": "query", "args": {"sql": "SELECT MNG_AGENCY, SUM(GIS_ACRES) FROM ... GROUP BY 1"}, "result": "...", "timestamp": "..."}
  ]
}
```

## jupyter-ai Integration

jupyter-geoagent ships with jupyter-ai v3 pre-installed. The Claude persona (powered by `claude-agent-acp`) runs Claude Code as an ACP subprocess with access to:

- **duckdb-geo MCP tools** — configured in `~/.jupyter/mcp_settings.json`; provides `query`, `get_collection`, `browse_stac_catalog`, etc.
- **Jupyter notebook tools** — 18 tools from `jupyter-server-mcp` at `localhost:3001`: read/write/execute cells, open files, run commands

The chat panel lives in the JupyterLab sidebar. Users can ask natural-language questions about catalog data; the agent can write query results directly into notebooks.

**Limitation:** the Claude persona cannot yet drive the GeoAgent map panel (add layers, set styles, etc.) — it has no access to `MapViewController`. Wiring that up would require exposing map tools via `jupyter-server-mcp`.

## Future Work

- **LLM-driven map** — expose `MapViewController` tools via `jupyter-server-mcp` so the Claude persona can add layers, set filters, and fly to locations from the chat panel.
- **Save/Load** — custom `.geoagent` document type for saving and reopening sessions.
- **Real-time collaboration** — yjs/CRDT integration for shared map editing (follows JupyterGIS pattern).
- **Python API** — `GeoAgentWidget` for programmatic use in notebooks by power users.
- **Local data** — drag-and-drop GeoJSON/GeoParquet files onto the map.

## Technology Stack

- **Frontend:** TypeScript, React, Lumino (JupyterLab widget framework), MapLibre GL JS, PMTiles
- **Server:** Python, Jupyter Server, tornado (HTTP handlers)
- **Build:** hatch-jupyter-builder (standard JupyterLab extension build), webpack
- **Geo-agent core:** imported as npm dependency from `boettiger-lab/geo-agent` GitHub repo
- **Target:** JupyterLab >= 4.5, Python >= 3.10
