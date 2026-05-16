/**
 * MapView — React wrapper around a MapLibre GL JS map instance.
 *
 * Manages the MapLibre lifecycle (create, resize, destroy) and provides
 * imperative methods for adding layers, toggling visibility, etc.
 * All map mutations go through this component so the ToolCallRecorder
 * can intercept them.
 */

import * as React from 'react';
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';
import { MapLayerConfig, LayerState, MapViewState, ColumnInfo } from '../core/types';
import type { MCPClientWrapper } from '../core/mcp';

const BASEMAPS: Record<string, { tiles: string[]; maxzoom: number }> = {
  natgeo: {
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 16,
  },
  satellite: {
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
  },
  plain: {
    tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
    maxzoom: 19,
  },
};

export interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  basemap?: string;
  titilerUrl?: string;
  onMapReady?: (mapView: MapViewController) => void;
}

/**
 * Imperative controller exposed via onMapReady callback.
 * Keeps React rendering separate from MapLibre mutations.
 */
export class MapViewController {
  map: maplibregl.Map;
  layers: Map<string, LayerState> = new Map();
  private titilerUrl: string;
  private _tooltip: HTMLDivElement;

  constructor(map: maplibregl.Map, titilerUrl: string, tooltip: HTMLDivElement) {
    this.map = map;
    this.titilerUrl = titilerUrl;
    this._tooltip = tooltip;
  }

  /**
   * Add a dataset layer to the map (from a processed MapLayerConfig).
   */
  addLayer(datasetId: string, config: MapLayerConfig, columns: ColumnInfo[] = []): string {
    const layerId = `${datasetId}/${config.assetId}`;
    const sourceId = `src-${layerId.replace(/[^a-zA-Z0-9]/g, '-')}`;

    if (this.map.getSource(sourceId)) {
      return layerId;
    }

    // Paint actually applied to the map — this must be the single source of
    // truth for LayerState.defaultStyle / currentStyle so the Style form
    // always has real content to show (not just a placeholder) for layers
    // that don't supply their own default_style in STAC.
    const appliedPaint: Record<string, any> =
      config.defaultStyle
        ? { ...config.defaultStyle }
        : config.layerType === 'vector'
          ? { 'fill-color': '#2E7D32', 'fill-opacity': 0.5 }
          : { 'raster-opacity': 0.7 };

    if (config.layerType === 'vector') {
      if (config.sourceType === 'geojson') {
        this.map.addSource(sourceId, { type: 'geojson', data: config.url! });
      } else {
        this.map.addSource(sourceId, {
          type: 'vector',
          url: `pmtiles://${config.url}`,
        });
      }

      const layerDef: maplibregl.LayerSpecification = {
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: appliedPaint as any,
        layout: { visibility: config.defaultVisible ? 'visible' : 'none' },
      };

      if (config.sourceLayer && config.sourceType !== 'geojson') {
        (layerDef as any)['source-layer'] = config.sourceLayer;
      }

      this.map.addLayer(layerDef);

      const outlineId = `${layerId}-outline`;
      const outlinePaint: Record<string, any> = config.outlineStyle
        ? { ...config.outlineStyle }
        : { 'line-color': '#333', 'line-width': 0.5, 'line-opacity': 0.5 };
      const outlineDef: maplibregl.LayerSpecification = {
        id: outlineId,
        type: 'line',
        source: sourceId,
        paint: outlinePaint as any,
        layout: { visibility: config.defaultVisible ? 'visible' : 'none' },
      };
      if (config.sourceLayer && config.sourceType !== 'geojson') {
        (outlineDef as any)['source-layer'] = config.sourceLayer;
      }
      this.map.addLayer(outlineDef);

      // Apply defaultFilter at add time — otherwise it's only stored in
      // LayerState and the rendered tiles show unfiltered features.
      if (config.defaultFilter) {
        this.map.setFilter(layerId, config.defaultFilter as any);
        this.map.setFilter(outlineId, config.defaultFilter as any);
      }

    } else if (config.layerType === 'raster') {
      let tilesUrl = `${this.titilerUrl}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(config.cogUrl!)}`;
      tilesUrl += `&colormap_name=${config.colormap || 'reds'}`;
      if (config.rescale) tilesUrl += `&rescale=${config.rescale}`;

      this.map.addSource(sourceId, {
        type: 'raster',
        tiles: [tilesUrl],
        tileSize: 256,
      });

      this.map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: appliedPaint as any,
        layout: { visibility: config.defaultVisible ? 'visible' : 'none' },
      });
    }

    const initialOpacity = config.layerType === 'raster' ? 0.7 : 0.5;
    const initialFillColor = config.layerType === 'vector'
      ? (config.defaultStyle?.['fill-color'] as string | undefined) || '#2E7D32'
      : undefined;

    this.layers.set(layerId, {
      id: layerId,
      kind: 'catalog',
      datasetId,
      assetId: config.assetId,
      displayName: config.title,
      type: config.layerType,
      visible: config.defaultVisible,
      opacity: initialOpacity,
      fillColor: initialFillColor,
      filter: config.defaultFilter,
      defaultFilter: config.defaultFilter,
      tooltipFields: config.tooltipFields ? [...config.tooltipFields] : null,
      defaultTooltipFields: config.tooltipFields ? [...config.tooltipFields] : null,
      defaultStyle: appliedPaint,
      currentStyle: { ...appliedPaint },
      colormap: config.colormap,
      rescale: config.rescale ?? undefined,
      sourceId,
      sourceLayer: config.sourceLayer,
      columns,
      versions: config.versions,
      currentVersionIndex: config.defaultVersionIndex,
      titilerUrl: this.titilerUrl,
      cogUrl: config.cogUrl,
    });

    if (config.layerType === 'vector') {
      this._wireTooltip(layerId, layerId);
    }

    return layerId;
  }

  showLayer(layerId: string): boolean {
    if (!this.map.getLayer(layerId)) return false;
    this.map.setLayoutProperty(layerId, 'visibility', 'visible');
    if (this.map.getLayer(`${layerId}-outline`)) {
      this.map.setLayoutProperty(`${layerId}-outline`, 'visibility', 'visible');
    }
    const state = this.layers.get(layerId);
    if (state) state.visible = true;
    return true;
  }

  hideLayer(layerId: string): boolean {
    if (!this.map.getLayer(layerId)) return false;
    this.map.setLayoutProperty(layerId, 'visibility', 'none');
    if (this.map.getLayer(`${layerId}-outline`)) {
      this.map.setLayoutProperty(`${layerId}-outline`, 'visibility', 'none');
    }
    const state = this.layers.get(layerId);
    if (state) state.visible = false;
    return true;
  }

  removeLayer(layerId: string): boolean {
    if (this.map.getLayer(`${layerId}-outline`)) {
      this.map.removeLayer(`${layerId}-outline`);
    }
    if (this.map.getLayer(layerId)) {
      this.map.removeLayer(layerId);
    }
    const state = this.layers.get(layerId);
    if (state && this.map.getSource(state.sourceId)) {
      this.map.removeSource(state.sourceId);
    }
    this.layers.delete(layerId);
    return true;
  }

  setFilter(layerId: string, filter: any[]): boolean {
    if (!this.map.getLayer(layerId)) return false;
    this.map.setFilter(layerId, filter as any);
    if (this.map.getLayer(`${layerId}-outline`)) {
      this.map.setFilter(`${layerId}-outline`, filter as any);
    }
    const state = this.layers.get(layerId);
    if (state) state.filter = filter;
    return true;
  }

  clearFilter(layerId: string): boolean {
    if (!this.map.getLayer(layerId)) return false;
    this.map.setFilter(layerId, null);
    if (this.map.getLayer(`${layerId}-outline`)) {
      this.map.setFilter(`${layerId}-outline`, null);
    }
    const state = this.layers.get(layerId);
    if (state) state.filter = undefined;
    return true;
  }

  setOpacity(layerId: string, opacity: number): boolean {
    const state = this.layers.get(layerId);
    if (!state || !this.map.getLayer(layerId)) return false;

    if (state.type === 'vector') {
      this.map.setPaintProperty(layerId, 'fill-opacity', opacity);
      if (this.map.getLayer(`${layerId}-outline`)) {
        this.map.setPaintProperty(`${layerId}-outline`, 'line-opacity', opacity);
      }
    } else if (state.type === 'raster') {
      this.map.setPaintProperty(layerId, 'raster-opacity', opacity);
    }
    state.opacity = opacity;
    // Sync opacity into currentStyle to prevent SetStyleForm drift
    if (state.currentStyle) {
      if (state.type === 'vector') {
        state.currentStyle['fill-opacity'] = opacity;
      } else if (state.type === 'raster') {
        state.currentStyle['raster-opacity'] = opacity;
      }
    }
    return true;
  }

  /**
   * Apply a MapLibre paint object to a layer. Spreads each key via
   * setPaintProperty so unspecified keys are left untouched. Updates
   * state.currentStyle to the merged result.
   */
  setStyle(layerId: string, style: Record<string, any>): boolean {
    const state = this.layers.get(layerId);
    if (!state || !this.map.getLayer(layerId)) return false;
    for (const [key, value] of Object.entries(style)) {
      try {
        this.map.setPaintProperty(layerId, key, value);
      } catch (err) {
        // Re-throw so caller (the form) can surface the error inline.
        throw err;
      }
    }
    state.currentStyle = { ...(state.currentStyle ?? {}), ...style };
    // Keep the derived scalar fields in sync for the bespoke controls.
    if (typeof style['fill-opacity'] === 'number') state.opacity = style['fill-opacity'];
    if (typeof style['raster-opacity'] === 'number') state.opacity = style['raster-opacity'];
    if (typeof style['fill-color'] === 'string') state.fillColor = style['fill-color'];
    return true;
  }

  /**
   * Reapply the paint object the layer was created with.
   */
  resetStyle(layerId: string): boolean {
    const state = this.layers.get(layerId);
    if (!state || !state.defaultStyle) return false;
    return this.setStyle(layerId, state.defaultStyle);
  }

  setTooltip(
    layerId: string,
    fields: string[],
  ): { success: true; layer: string; displayName: string; tooltipFields: string[] | null }
    | { success: false; error: string } {
    const state = this.layers.get(layerId);
    if (!state) return { success: false, error: `Unknown layer: ${layerId}` };
    if (state.type !== 'vector') {
      return { success: false, error: `Tooltips only apply to vector layers; '${layerId}' is ${state.type}` };
    }
    if (!Array.isArray(fields) || !fields.every(f => typeof f === 'string')) {
      return { success: false, error: 'fields must be an array of strings' };
    }
    state.tooltipFields = fields.length > 0 ? [...fields] : null;
    return { success: true, layer: layerId, displayName: state.displayName, tooltipFields: state.tooltipFields };
  }

  resetTooltip(
    layerId: string,
  ): { success: true; layer: string; displayName: string; tooltipFields: string[] | null }
    | { success: false; error: string } {
    const state = this.layers.get(layerId);
    if (!state) return { success: false, error: `Unknown layer: ${layerId}` };
    if (state.type !== 'vector') {
      return { success: false, error: `Tooltips only apply to vector layers; '${layerId}' is ${state.type}` };
    }
    state.tooltipFields = state.defaultTooltipFields ? [...state.defaultTooltipFields] : null;
    return { success: true, layer: layerId, displayName: state.displayName, tooltipFields: state.tooltipFields };
  }

  /**
   * Apply the config default filter, or clear if none.
   */
  resetFilter(layerId: string): boolean {
    const state = this.layers.get(layerId);
    if (!state) return false;
    if (state.defaultFilter) return this.setFilter(layerId, state.defaultFilter);
    return this.clearFilter(layerId);
  }

  /**
   * Filter a vector layer by the results of a SQL query, via MCP.
   * Ports node_modules/geo-agent/app/map-tools.js filter_by_query.execute.
   * The ID array stays on the client — never passes through the LLM.
   */
  async filterByQuery(
    layerId: string,
    sql: string,
    idProperty: string,
    mcpClient: MCPClientWrapper,
  ): Promise<
    | { success: true; idCount: number; featuresInView?: number; message?: string }
    | { success: false; error: string }
  > {
    const state = this.layers.get(layerId);
    if (!state || state.type !== 'vector') {
      return { success: false, error: `Layer ${layerId} is not a vector layer.` };
    }

    const col = idProperty;
    const wrappedSql = `SELECT to_json(array_agg("${col}") FILTER (WHERE "${col}" IS NOT NULL)) AS ids FROM (${sql}) _filter_subquery`;

    let rawResult: string;
    try {
      rawResult = await mcpClient.callTool('query', { sql_query: wrappedSql });
    } catch (err: any) {
      return { success: false, error: `SQL execution failed: ${err.message}` };
    }

    // DuckDB returns NULL (not []) when no rows match.
    const trimmed = rawResult.trim();
    if (!trimmed || /\bnull\b/i.test(trimmed.replace(/.*\n/, ''))) {
      return { success: true, idCount: 0, message: 'Query matched no features — filter not applied.' };
    }

    // Extract the JSON array from the MCP response (same heuristic as geo-agent).
    const match = rawResult.match(/\[[\s\S]*\]/);
    if (!match) {
      return {
        success: false,
        error: `Could not parse ID list from query result. Check that id_property ("${col}") exactly matches the column name in the SQL output. Raw: ${rawResult.substring(0, 300)}`,
      };
    }
    let ids: any[];
    try {
      ids = JSON.parse(match[0]);
    } catch {
      return {
        success: false,
        error: `Could not parse ID list from query result. Raw: ${rawResult.substring(0, 300)}`,
      };
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: true, idCount: 0, featuresInView: 0, message: 'Query matched no features — filter not applied.' };
    }

    const filter: any[] = ['in', ['get', col], ['literal', ids]];
    this.setFilter(layerId, filter);
    const featuresInView = this.map.queryRenderedFeatures({ layers: [layerId] }).length;
    return { success: true, idCount: ids.length, featuresInView };
  }

  private _retileRaster(layerId: string): boolean {
    const state = this.layers.get(layerId);
    if (!state || state.type !== 'raster' || !state.cogUrl || !state.titilerUrl) return false;

    let tilesUrl = `${state.titilerUrl}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(state.cogUrl)}`;
    tilesUrl += `&colormap_name=${state.colormap || 'reds'}`;
    if (state.rescale) tilesUrl += `&rescale=${state.rescale}`;

    const source = this.map.getSource(state.sourceId) as maplibregl.RasterTileSource | undefined;
    if (!source || typeof (source as any).setTiles !== 'function') return false;
    (source as any).setTiles([tilesUrl]);
    return true;
  }

  setColormap(layerId: string, colormap: string): boolean {
    const state = this.layers.get(layerId);
    if (!state || state.type !== 'raster') return false;
    state.colormap = colormap;
    return this._retileRaster(layerId);
  }

  setRescale(layerId: string, rescale: string | undefined): boolean {
    const state = this.layers.get(layerId);
    if (!state || state.type !== 'raster') return false;
    state.rescale = rescale;
    return this._retileRaster(layerId);
  }

  switchVersion(layerId: string, versionIndex: number): boolean {
    const state = this.layers.get(layerId);
    if (!state || !state.versions || versionIndex < 0 || versionIndex >= state.versions.length) return false;
    const v = state.versions[versionIndex];

    if (state.type === 'vector') {
      const source = this.map.getSource(state.sourceId) as any;
      if (!source) return false;
      if (v.sourceType === 'geojson' && v.url) {
        if (typeof source.setData === 'function') source.setData(v.url);
        else return false;
      } else if (v.url) {
        if (typeof source.setUrl === 'function') source.setUrl(`pmtiles://${v.url}`);
        else return false;
      }
      if (v.sourceLayer && v.sourceLayer !== state.sourceLayer) {
        // MapLibre has no public setSourceLayer; remove & re-add both layers to swap source-layer.
        const fill = this.map.getLayer(layerId);
        const outline = this.map.getLayer(`${layerId}-outline`);
        if (fill) this.map.removeLayer(layerId);
        if (outline) this.map.removeLayer(`${layerId}-outline`);

        const fillPaint = state.currentStyle ?? { 'fill-color': '#2E7D32', 'fill-opacity': state.opacity };
        this.map.addLayer({
          id: layerId,
          type: 'fill',
          source: state.sourceId,
          'source-layer': v.sourceLayer,
          paint: fillPaint as any,
          layout: { visibility: state.visible ? 'visible' : 'none' },
        } as any);
        this.map.addLayer({
          id: `${layerId}-outline`,
          type: 'line',
          source: state.sourceId,
          'source-layer': v.sourceLayer,
          paint: { 'line-color': '#333', 'line-width': 0.5, 'line-opacity': state.opacity },
          layout: { visibility: state.visible ? 'visible' : 'none' },
        } as any);
        if (state.filter) {
          this.map.setFilter(layerId, state.filter as any);
          this.map.setFilter(`${layerId}-outline`, state.filter as any);
        }
        state.sourceLayer = v.sourceLayer;
      }
    } else if (state.type === 'raster' && v.cogUrl) {
      state.cogUrl = v.cogUrl;
      this._retileRaster(layerId);
    } else {
      return false;
    }

    state.currentVersionIndex = versionIndex;
    return true;
  }

  flyTo(center: [number, number], zoom?: number): void {
    this.map.flyTo({ center, zoom: zoom || this.map.getZoom() });
  }

  getViewState(): MapViewState {
    const center = this.map.getCenter();
    return {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
    };
  }

  getVisibleLayers(): LayerState[] {
    return [...this.layers.values()].filter(l => l.visible);
  }

  setBasemap(name: string): void {
    for (const [key] of Object.entries(BASEMAPS)) {
      const visibility = key === name ? 'visible' : 'none';
      if (this.map.getLayer(`${key}-base`)) {
        this.map.setLayoutProperty(`${key}-base`, 'visibility', visibility);
      }
    }
  }

  resize(): void {
    this.map.resize();
  }

  private _wireTooltip(mapLayerId: string, layerId: string): void {
    this.map.on('mousemove', mapLayerId, (e) => {
      const fields = this.layers.get(layerId)?.tooltipFields;
      if (!fields || fields.length === 0) return;
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties ?? {};
      const rows = fields
        .filter((f: string) => props[f] !== undefined && props[f] !== null && props[f] !== '')
        .map((f: string) => `<tr><th>${f}</th><td>${this._formatTooltipValue(f, props[f])}</td></tr>`)
        .join('');
      if (!rows) return;
      this._tooltip.innerHTML = `<table>${rows}</table>`;
      this._tooltip.style.display = 'block';
      const rect = this.map.getContainer().getBoundingClientRect();
      this._tooltip.style.left = (e.originalEvent.clientX - rect.left + 12) + 'px';
      this._tooltip.style.top = (e.originalEvent.clientY - rect.top - 12) + 'px';
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', mapLayerId, () => {
      this._tooltip.style.display = 'none';
      this.map.getCanvas().style.cursor = '';
    });
  }

  private _formatTooltipValue(field: string, value: any): string | number {
    const lf = field.toLowerCase();
    if (typeof value === 'number' && (lf.includes('value') || lf.includes('price') || lf.includes('cost'))) {
      return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    if (typeof value === 'number' && (lf.includes('acres') || lf.includes('area'))) {
      return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
    }
    return value;
  }
}

export const MapView: React.FC<MapViewProps> = ({
  center = [-98, 39],
  zoom = 4,
  basemap = 'natgeo',
  titilerUrl = 'https://titiler.nrp-nautilus.io',
  onMapReady,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Register PMTiles protocol
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          natgeo: { type: 'raster', tiles: BASEMAPS.natgeo.tiles, tileSize: 256, maxzoom: BASEMAPS.natgeo.maxzoom },
          satellite: { type: 'raster', tiles: BASEMAPS.satellite.tiles, tileSize: 256, maxzoom: BASEMAPS.satellite.maxzoom },
          plain: { type: 'raster', tiles: BASEMAPS.plain.tiles, tileSize: 256, maxzoom: BASEMAPS.plain.maxzoom },
        },
        layers: [
          { id: 'natgeo-base', type: 'raster', source: 'natgeo', layout: { visibility: basemap === 'natgeo' ? 'visible' : 'none' } },
          { id: 'satellite-base', type: 'raster', source: 'satellite', layout: { visibility: basemap === 'satellite' ? 'visible' : 'none' } },
          { id: 'plain-base', type: 'raster', source: 'plain', layout: { visibility: basemap === 'plain' ? 'visible' : 'none' } },
        ],
      },
      center,
      zoom,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      mapRef.current = map;
      if (!tooltipRef.current) return;
      const controller = new MapViewController(map, titilerUrl, tooltipRef.current);
      if (onMapReady) onMapReady(controller);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="jp-GeoAgent-map"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <div ref={tooltipRef} className="jp-GeoAgent-tooltip" />
    </div>
  );
};
