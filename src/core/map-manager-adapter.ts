/**
 * Adapter that exposes MapViewController through the MapManager surface
 * expected by geo-agent/app/map-tools.js createMapTools().
 *
 * Two translations happen here:
 *   1. Return shapes: MapViewController returns booleans; MapManager tools
 *      expect { success: true, layer, ... } on success, { success: false,
 *      error: "..." } on failure (with helpful "Available: a, b, c" hints).
 *   2. Method names: getMapState (not getViewState), syncCheckbox (which
 *      becomes a UI-refresh trigger).
 */

import type { MapViewController } from '../components/MapView';

export interface MapManagerAdapterOptions {
  /** Called after any state-mutating operation so React panels re-render. */
  onChange?: () => void;
}

export class MapManagerAdapter {
  constructor(
    private controller: MapViewController,
    private options: MapManagerAdapterOptions = {},
  ) {}

  // --- layer id enumerations (used by tool descriptions) ---

  getLayerIds(): string[] {
    return [...this.controller.layers.keys()];
  }

  getVectorLayerIds(): string[] {
    return [...this.controller.layers.entries()]
      .filter(([, s]) => s.type === 'vector')
      .map(([id]) => id);
  }

  /** Upstream geo-agent tools call this instead of getLayerIds/getVectorLayerIds. */
  getLayerSummaries(): Array<{ id: string; displayName: string; type: 'vector' | 'raster' }> {
    return [...this.controller.layers.entries()].map(([id, state]) => ({
      id,
      displayName: state.displayName,
      type: state.type,
    }));
  }

  // --- show / hide ---

  showLayer(layerId: string) {
    const state = this.controller.layers.get(layerId);
    if (!state) {
      return { success: false, error: `Unknown layer: ${layerId}. Available: ${this.getLayerIds().join(', ') || '(none)'}` };
    }
    this.controller.showLayer(layerId);
    this.options.onChange?.();
    return { success: true, layer: layerId, displayName: state.displayName, visible: true };
  }

  hideLayer(layerId: string) {
    const state = this.controller.layers.get(layerId);
    if (!state) {
      return { success: false, error: `Unknown layer: ${layerId}. Available: ${this.getLayerIds().join(', ') || '(none)'}` };
    }
    this.controller.hideLayer(layerId);
    this.options.onChange?.();
    return { success: true, layer: layerId, displayName: state.displayName, visible: false };
  }

  // --- filter ---

  setFilter(layerId: string, filter: any) {
    const state = this.controller.layers.get(layerId);
    if (!state) return { success: false, error: `Unknown layer: ${layerId}` };
    if (state.type !== 'vector') return { success: false, error: `Layer '${layerId}' is raster — filtering only works on vector layers` };

    if (filter === null || filter === undefined) {
      this.controller.clearFilter(layerId);
    } else {
      this.controller.setFilter(layerId, filter);
    }
    this.options.onChange?.();

    const features = this.controller.map.queryRenderedFeatures({ layers: [layerId] });
    const result: any = {
      success: true,
      layer: layerId,
      displayName: state.displayName,
      filter: filter ?? null,
      featuresInView: features.length,
    };
    if (filter && features.length === 0) {
      result.warning = 'No features match this filter in the current view. Filter may be too restrictive or property values may not match; if the layer was just added or the map was just flown to a new region, tiles may not have loaded yet — wait a moment and re-check. Use filter_by_query to verify via SQL.';
    }
    return result;
  }

  clearFilter(layerId: string) {
    return this.setFilter(layerId, null);
  }

  resetFilter(layerId: string) {
    const state = this.controller.layers.get(layerId);
    if (!state) return { success: false, error: `Unknown layer: ${layerId}` };
    return this.setFilter(layerId, state.defaultFilter ?? null);
  }

  // --- style ---

  setStyle(layerId: string, paintProps: Record<string, any>) {
    const state = this.controller.layers.get(layerId);
    if (!state) return { success: false, error: `Unknown layer: ${layerId}` };

    const updates: Array<{ property: string; success: boolean; error?: string }> = [];
    for (const [prop, value] of Object.entries(paintProps)) {
      try {
        this.controller.setStyle(layerId, { [prop]: value });
        updates.push({ property: prop, success: true });
      } catch (err: any) {
        updates.push({ property: prop, success: false, error: err.message });
      }
    }
    this.options.onChange?.();
    const anySucceeded = updates.length === 0 || updates.some(u => u.success);
    return {
      success: anySucceeded,
      layer: layerId,
      displayName: state.displayName,
      updates,
      ...(anySucceeded ? {} : { error: 'All style properties failed to apply; see updates[].error' }),
    };
  }

  resetStyle(layerId: string) {
    const state = this.controller.layers.get(layerId);
    if (!state) return { success: false, error: `Unknown layer: ${layerId}` };
    this.controller.resetStyle(layerId);
    this.options.onChange?.();
    return { success: true, layer: layerId, displayName: state.displayName };
  }

  setTooltip(layerId: string, fields: string[]) {
    const result = this.controller.setTooltip(layerId, fields);
    if (result.success) this.options.onChange?.();
    return result;
  }

  resetTooltip(layerId: string) {
    const result = this.controller.resetTooltip(layerId);
    if (result.success) this.options.onChange?.();
    return result;
  }

  // --- view ---

  flyTo({ center, zoom }: { center: [number, number]; zoom?: number }) {
    // No onChange: camera motion doesn't affect Layer/Style panel state.
    this.controller.flyTo(center, zoom);
    return { success: true, center, zoom: zoom ?? this.controller.map.getZoom() };
  }

  getMapState() {
    const layers: Record<string, any> = {};
    for (const [id, state] of this.controller.layers) {
      layers[id] = {
        displayName: state.displayName,
        type: state.type,
        visible: state.visible,
        opacity: state.opacity,
        filter: state.filter ?? null,
      };
    }
    const view = this.controller.getViewState();
    return { success: true, view, layers };
  }

  // geo-agent's tool code calls this after show/hide to update a legacy DOM
  // checkbox. In jupyter-geoagent the React Layers panel re-renders on
  // onChange, so this is the bridge that keeps it in sync. Note that
  // showLayer/hideLayer already fire onChange themselves; the duplicate
  // call here is idempotent (React batches re-renders).
  syncCheckbox(_layerId: string): void {
    this.options.onChange?.();
  }

  // setProjection not supported yet — see plan non-goals.
  setProjection(_type: string) {
    return { success: false, error: 'Projection switching is not yet implemented in jupyter-geoagent.' };
  }
}
