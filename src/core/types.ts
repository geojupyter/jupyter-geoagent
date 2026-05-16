/**
 * Types specific to jupyter-geoagent.
 *
 * MapLayerConfig and ColumnInfo were previously imported from geo-agent's
 * dataset-catalog module. They are now defined locally so the extension
 * can run without the geo-agent npm package as a runtime dependency for
 * catalog browsing.
 */

// ── Column / schema info (mirrors STAC table:columns) ──

export interface ColumnInfo {
  name: string;
  type: string;
  description: string;
  values?: string[];
}

// ── Map layer configuration (accepted by MapViewController.addLayer) ──

export interface MapLayerConfig {
  assetId: string;
  layerType: 'vector' | 'raster';
  sourceType?: 'geojson';
  title: string;
  description: string;
  url?: string;
  cogUrl?: string;
  sourceLayer?: string;
  defaultVisible: boolean;
  defaultFilter?: any[];
  /** Property names to render on hover. Mirrors the upstream layers-input.json field. */
  tooltipFields?: string[];
  defaultStyle?: Record<string, any>;
  outlineStyle?: Record<string, any>;
  colormap?: string;
  rescale?: string | null;
  versions?: Array<{
    label: string;
    assetId: string;
    layerType: string;
    url?: string;
    cogUrl?: string;
    sourceLayer?: string;
    sourceType?: string;
  }>;
  defaultVersionIndex?: number;
}

// ── Tool call recording (jupyter-geoagent specific) ──

export interface RecordedToolCall {
  id: number;
  tool: string;
  args: Record<string, any>;
  result?: string;
  timestamp: string;
}

export interface ToolCallLog {
  version: string;
  catalog: string;
  created: string;
  calls: RecordedToolCall[];
}

// ── Map view state ──

export interface MapViewState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

// ── Layer state (UI tracking, not geo-agent's internal state) ──

export interface LayerState {
  id: string;
  /** Which kind of layer this is. Catalog layers come from STAC + addLayer; hex layers come from addHexTileLayer. */
  kind: 'catalog' | 'hex';
  /** STAC collection id. Required for catalog layers; absent for hex layers. */
  datasetId?: string;
  /** STAC asset id (the visual asset key). Required for catalog layers; absent for hex layers. */
  assetId?: string;
  displayName: string;
  type: 'vector' | 'raster';
  visible: boolean;
  opacity: number;
  fillColor?: string;
  filter?: any[];
  defaultFilter?: any[];
  /** Tooltip property names (current). null/undefined disables the tooltip. */
  tooltipFields?: string[] | null;
  /** Tooltip property names from the config default (used by reset_tooltip). */
  defaultTooltipFields?: string[] | null;
  /** Original paint from MapLayerConfig.defaultStyle — never mutated after addLayer. */
  defaultStyle?: Record<string, any>;
  /** Live paint: seeded from defaultStyle, updated by setStyle. */
  currentStyle?: Record<string, any>;
  colormap?: string;
  rescale?: string;
  sourceId: string;
  sourceLayer?: string;
  columns: ColumnInfo[];
  versions?: Array<{
    label: string;
    assetId: string;
    layerType: string;
    url?: string;
    cogUrl?: string;
    sourceLayer?: string;
    sourceType?: string;
  }>;
  currentVersionIndex?: number;
  /** TiTiler base URL captured at layer creation, so raster retile calls don't need to thread it through. */
  titilerUrl?: string;
  /** The original COG url (raster only), kept so we can rebuild the tiles URL on colormap/rescale change. */
  cogUrl?: string;
}

// ── Export formats ──

export interface LayersInputConfig {
  catalog: string;
  titiler_url: string;
  view: MapViewState;
  collections: Array<string | {
    collection_id: string;
    assets?: Array<string | { id: string; display_name?: string; visible?: boolean }>;
  }>;
}

// ── MCP server configuration ──

export interface MCPServerConfig {
  name: string;
  url: string;
  type: 'remote' | 'local';
  headers?: Record<string, string>;
}
