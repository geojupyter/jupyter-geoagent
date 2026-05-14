# Port new upstream geo-agent map tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four new upstream `geo-agent` map tools (`set_tooltip`, `reset_tooltip`, `add_hex_tile_layer`, `remove_hex_tile_layer`) fully functional in this JupyterLab extension.

**Architecture:** Bump the pinned upstream commit so `createMapTools()` includes the new tools; add the underlying primitives (tooltip DOM + per-layer state; hex MVT layer plumbing) to `MapViewController`; wrap them in `MapManagerAdapter`. Hex layers participate in the Layers panel (visibility / opacity / remove only) but are excluded from `layers-input.json` exports.

**Tech Stack:** TypeScript, React 18, MapLibre GL JS v5, PMTiles, JupyterLab 4 extension build (`hatch-jupyter-builder` + `jlpm`).

**Verification model:** This repo has no test harness (no vitest, no playwright). Each task ends with `jlpm build:lib` (which runs `tsc --sourceMap`) as the type-check gate. Functional verification is the manual smoke at the end of the plan.

**Spec:** [`docs/superpowers/specs/2026-05-14-upstream-map-tools-design.md`](../specs/2026-05-14-upstream-map-tools-design.md)

---

## Task 1: Bump the geo-agent upstream pin

**Files:**
- Modify: `package.json` (the `geo-agent` dependency entry)
- Modify: `yarn.lock` (regenerated)

After this task, the four new tools become visible to `createMapTools()` but calls will fail at runtime (the adapter doesn't implement the primitives yet). That's expected — subsequent tasks fix it. Building still succeeds because `commands.ts` only reads each tool's `name`, `description`, and `inputSchema` from the stub-built tool list at activation time.

- [ ] **Step 1: Update the git ref in `package.json`**

In `package.json`, find:

```json
"geo-agent": "git+https://github.com/boettiger-lab/geo-agent.git",
```

Replace with the pinned commit form so the lock is reproducible:

```json
"geo-agent": "git+https://github.com/boettiger-lab/geo-agent.git#988b83ef76feb957da7a71a63d8250bd0b1eb00b",
```

- [ ] **Step 2: Refresh yarn.lock**

Run: `jlpm install`
Expected: `yarn.lock` updates the `geo-agent@...` resolution to `commit=988b83ef76feb957da7a71a63d8250bd0b1eb00b`.

- [ ] **Step 3: Diff upstream `app/map-tools.js` between pinned commits to confirm adapter compatibility**

Run:
```bash
git -C node_modules/geo-agent log --oneline bd724a5..988b83e -- app/map-tools.js app/map-manager.js 2>/dev/null || (cd /tmp && rm -rf geo-agent-check && git clone --quiet https://github.com/boettiger-lab/geo-agent.git geo-agent-check && cd geo-agent-check && git log --oneline bd724a5..988b83e -- app/map-tools.js app/map-manager.js)
```

Expected: a short list (the commits we already cataloged in the spec — `36db843`, `d191230`, `4e4855c`, `6f04c47`, `3ca96f8`, `d0e5220`, `8bb3d29`, `e8cb529`, `297e2a5`, `013d803`, `ef13eaa`, `f23fcac`, plus merges). No surprise calls into `mapManager.*` that the adapter doesn't already implement other than the four new methods we're about to add (`setTooltip`, `resetTooltip`, `addHexTileLayer`, `removeHexTileLayer`). If anything else turns up, stop and reconcile against the spec.

- [ ] **Step 4: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS. No new type errors. (The new tools are inside the stub-built tool list; nothing in our code calls the new mapManager methods yet.)

- [ ] **Step 5: Commit**

```bash
git add package.json yarn.lock
git commit -m "deps: bump geo-agent to 988b83e for new map tools"
```

---

## Task 2: Extend LayerState for the hex / tooltip surface

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/components/MapView.tsx` (one site: the `this.layers.set(...)` call inside `addLayer`)
- Modify: `src/components/ExportPanel.tsx` (filter hex layers before iterating)

This is a typing-only migration. `kind: 'catalog' | 'hex'` is the discriminator; `datasetId` / `assetId` are downgraded to optional because hex layers don't have them. The single existing call site in `MapViewController.addLayer` sets `kind: 'catalog'`. `ExportPanel.tsx` filters by `kind === 'catalog'` (equivalently `!== 'hex'`) before iterating, since it depends on `layer.datasetId` being defined.

- [ ] **Step 1: Update the `LayerState` interface**

In `src/core/types.ts`, replace the existing `LayerState` interface body so it reads:

```typescript
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
```

- [ ] **Step 2: Add `tooltipFields` to `MapLayerConfig`**

In `src/core/types.ts`, in the `MapLayerConfig` interface, add this optional field (place it next to `defaultFilter`):

```typescript
  /** Property names to render on hover. Mirrors the upstream layers-input.json field. */
  tooltipFields?: string[];
```

- [ ] **Step 3: Set `kind: 'catalog'` in `MapViewController.addLayer`**

In `src/components/MapView.tsx`, locate the `this.layers.set(layerId, { ... })` block inside `addLayer` (currently starting near line 147). Add `kind: 'catalog'` as the first field of the object literal:

```typescript
    this.layers.set(layerId, {
      id: layerId,
      kind: 'catalog',
      datasetId,
      assetId: config.assetId,
      // ... rest unchanged
    });
```

- [ ] **Step 4: Filter hex layers out of `buildLayersInputConfig`**

In `src/components/ExportPanel.tsx`, in `buildLayersInputConfig`, change the line:

```typescript
  const layers = [...mapController.layers.values()];
```

to:

```typescript
  const layers = [...mapController.layers.values()].filter(l => l.kind === 'catalog');
```

This filter is enough on its own. The project's `tsconfig.json` has `strictNullChecks: false`, so the subsequent `layer.datasetId` accesses still type-check even though the field is now `string | undefined` on the interface. Don't add a type predicate — it's noise in this codebase.

- [ ] **Step 5: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS. No new type errors. If any surface (e.g. another file reading `layer.datasetId` without a guard), the build will flag it — fix at the same site by checking `kind === 'catalog'` first.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/components/MapView.tsx src/components/ExportPanel.tsx
git commit -m "types: add kind/tooltipFields to LayerState, make datasetId optional"
```

---

## Task 3: Add the tooltip DOM and wiring to MapView

**Files:**
- Modify: `src/components/MapView.tsx` (add tooltip element + ref, `_tooltip`/`_wireTooltip`/`_formatTooltipValue` on the controller, extend `addLayer` to seed and wire tooltips)
- Modify: `style/base.css` (`.jp-GeoAgent-tooltip` rule)

The tooltip DOM is a sibling of the canvas inside the map container. Its lifetime is bound to the React `MapView` effect (it gets removed when the component unmounts). The controller holds a ref to it; mousemove handlers update its innerHTML and position; mouseleave hides it. `_wireTooltip` reads `state.tooltipFields` at event time (not at bind time) so subsequent `setTooltip` calls take effect immediately.

- [ ] **Step 1: Add the tooltip element to the rendered container**

In `src/components/MapView.tsx`, replace the final `return (...)` block of the `MapView` component (currently:

```tsx
  return (
    <div
      ref={containerRef}
      className="jp-GeoAgent-map"
      style={{ width: '100%', height: '100%' }}
    />
  );
```

with:

```tsx
  const tooltipRef = React.useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="jp-GeoAgent-map"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <div ref={tooltipRef} className="jp-GeoAgent-tooltip" />
    </div>
  );
```

Then move the `tooltipRef` declaration up next to `containerRef` (above the `useEffect`):

```tsx
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
```

- [ ] **Step 2: Wire the tooltip ref into the controller constructor**

In `src/components/MapView.tsx`, change the `MapViewController` constructor to accept the tooltip element:

```typescript
  private _tooltip: HTMLDivElement;

  constructor(map: maplibregl.Map, titilerUrl: string, tooltip: HTMLDivElement) {
    this.map = map;
    this.titilerUrl = titilerUrl;
    this._tooltip = tooltip;
  }
```

Update the `MapViewController` instantiation in the `map.on('load', ...)` callback near the end of the file:

```typescript
    map.on('load', () => {
      mapRef.current = map;
      if (!tooltipRef.current) return;
      const controller = new MapViewController(map, titilerUrl, tooltipRef.current);
      if (onMapReady) onMapReady(controller);
    });
```

- [ ] **Step 3: Add `_wireTooltip` and `_formatTooltipValue` to `MapViewController`**

In `src/components/MapView.tsx`, add these methods to the `MapViewController` class (place them near the end of the class, before the closing brace). The handlers read `tooltipFields` at event time so they stay in sync with `setTooltip` calls:

```typescript
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
```

Note: positions are computed relative to the map container (not the viewport), because the JupyterLab panel is not flush with the viewport.

- [ ] **Step 4: Extend `addLayer` to seed tooltip defaults and call `_wireTooltip`**

In `src/components/MapView.tsx`, in `addLayer`, set the tooltip fields when populating `LayerState`. Inside the `this.layers.set(layerId, { ... })` literal, add these fields next to `defaultFilter`:

```typescript
      filter: config.defaultFilter,
      defaultFilter: config.defaultFilter,
      tooltipFields: config.tooltipFields ? [...config.tooltipFields] : null,
      defaultTooltipFields: config.tooltipFields ? [...config.tooltipFields] : null,
```

Then, just before the function's `return layerId;`, call `_wireTooltip`. This must happen after the fill layer exists on the map. For vector layers it wires on `layerId`; for raster layers, tooltips don't apply (no per-feature properties), so the wiring is gated:

```typescript
    if (config.layerType === 'vector') {
      this._wireTooltip(layerId, layerId);
    }

    return layerId;
```

- [ ] **Step 5: Add the tooltip CSS**

In `style/base.css`, append:

```css
.jp-GeoAgent-tooltip {
  position: absolute;
  display: none;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 3px;
  padding: 4px 6px;
  font-size: 11px;
  color: #222;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  max-width: 320px;
  z-index: 10;
}

.jp-GeoAgent-tooltip table {
  border-collapse: collapse;
}

.jp-GeoAgent-tooltip th,
.jp-GeoAgent-tooltip td {
  padding: 1px 4px;
  vertical-align: top;
  text-align: left;
}

.jp-GeoAgent-tooltip th {
  font-weight: 600;
  color: #555;
}
```

- [ ] **Step 6: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MapView.tsx style/base.css
git commit -m "feat(map): tooltip DOM + per-layer hover wiring"
```

---

## Task 4: Add setTooltip / resetTooltip on controller and adapter

**Files:**
- Modify: `src/components/MapView.tsx` (`setTooltip` / `resetTooltip` on `MapViewController`)
- Modify: `src/core/map-manager-adapter.ts` (corresponding adapter methods)

The controller mutates `state.tooltipFields` and returns the upstream `{success, layer, displayName, tooltipFields}` shape directly. The adapter validates `state.type === 'vector'` (so the upstream error message matches) and passes through, plus fires `onChange` so any future tooltip UI re-renders. Since the active tooltip-handler closure re-reads `state.tooltipFields` on every mousemove, no rebind is needed.

- [ ] **Step 1: Add `setTooltip` and `resetTooltip` to `MapViewController`**

In `src/components/MapView.tsx`, add these methods to the `MapViewController` class (next to `setStyle` / `resetStyle`):

```typescript
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
```

- [ ] **Step 2: Add `setTooltip` / `resetTooltip` to `MapManagerAdapter`**

In `src/core/map-manager-adapter.ts`, add these methods to the `MapManagerAdapter` class (place them after `resetStyle`, before `flyTo`):

```typescript
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
```

- [ ] **Step 3: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/MapView.tsx src/core/map-manager-adapter.ts
git commit -m "feat(map): setTooltip / resetTooltip on controller and adapter"
```

---

## Task 5: Add addHexTileLayer / removeHexTileLayer on the controller

**Files:**
- Modify: `src/components/MapView.tsx` (import `hex-layer-helpers`; add `addHexTileLayer` / `removeHexTileLayer`)

The implementation mirrors upstream's `app/map-manager.js` (`addHexTileLayer`, `removeHexTileLayer`, lines 502–627). Hex layers register a LayerState with `kind: 'hex'`, share `sourceId = layerId`, omit `datasetId` / `assetId`, and get `_wireTooltip` so the user can later call `set_tooltip` on them.

Idempotency: same `tileUrl` hash → same layer id → no re-add. Returns the upstream shape.

- [ ] **Step 1: Import the hex helpers**

In `src/components/MapView.tsx`, add this import near the top alongside the existing imports:

```typescript
import { extractHashFromUrl, buildFillColorExpression } from 'geo-agent/app/hex-layer-helpers.js';
```

`geo-agent` ships no `.d.ts` files, but the project `tsconfig.json` has `skipLibCheck: true` and `strict: false` — the same pattern `commands.ts` uses for its `createMapTools` import works here without any annotation. If the build does flag a missing-types error (it shouldn't), follow the existing pattern in `commands.ts:16`.

- [ ] **Step 2: Add `addHexTileLayer` to `MapViewController`**

In `src/components/MapView.tsx`, add this method to `MapViewController` (place after `flyTo`, before `getViewState`):

```typescript
  addHexTileLayer(opts: {
    tileUrl: string;
    valueColumn: string;
    valueStats: { by_res: Record<string, { min: number; max: number }> };
    bounds: [number, number, number, number];
    palette?: 'viridis' | 'ylorrd' | 'bluered';
    opacity?: number;
    displayName: string;
    fitBounds?: boolean;
    layerName?: string;
  }): {
    success: true;
    layer_id: string;
    display_name: string;
    value_column: string;
    bounds: [number, number, number, number];
    already_exists: boolean;
    message?: string;
  } | { success: false; error: string } {
    const { tileUrl, valueColumn, valueStats, bounds, palette = 'viridis', opacity = 0.7, displayName, fitBounds = true, layerName } = opts;
    const sourceLayer = layerName || 'layer';

    const hash = extractHashFromUrl(tileUrl);
    if (!hash) {
      return { success: false, error: 'Invalid tile_url — expected template from register_hex_tiles ending in /tiles/hex/<hash>/{z}/{x}/{y}.pbf' };
    }
    const layerId = `hex-${hash}`;

    if (this.layers.has(layerId)) {
      const state = this.layers.get(layerId)!;
      return {
        success: true,
        layer_id: layerId,
        display_name: state.displayName,
        value_column: valueColumn,
        bounds,
        already_exists: true,
        message: 'Layer already registered. Use remove_hex_tile_layer first to re-add with different styling.',
      };
    }

    const availableRes = Object.keys(valueStats?.by_res || {}).map(Number).sort((a, b) => a - b);
    if (availableRes.length === 0) {
      return { success: false, error: 'value_stats.by_res must contain at least one resolution' };
    }

    let fillColor: any;
    try {
      fillColor = buildFillColorExpression(valueColumn, valueStats, palette);
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }

    const paint = {
      'fill-color': fillColor,
      'fill-opacity': opacity,
      'fill-outline-color': 'rgba(0,0,0,0.15)',
    };

    this.map.addSource(layerId, { type: 'vector', tiles: [tileUrl], minzoom: 0, maxzoom: 14 });
    this.map.addLayer({
      id: layerId,
      type: 'fill',
      source: layerId,
      'source-layer': sourceLayer,
      layout: { visibility: 'visible' },
      paint: paint as any,
    });

    this.layers.set(layerId, {
      id: layerId,
      kind: 'hex',
      displayName,
      type: 'vector',
      visible: true,
      opacity,
      filter: undefined,
      defaultFilter: undefined,
      tooltipFields: null,
      defaultTooltipFields: null,
      defaultStyle: { ...paint },
      currentStyle: { ...paint },
      sourceId: layerId,
      sourceLayer,
      columns: [],
    });

    this._wireTooltip(layerId, layerId);

    if (fitBounds && Array.isArray(bounds) && bounds.length === 4) {
      const [w, s, e, n] = bounds;
      this.map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 800 });
    }

    return {
      success: true,
      layer_id: layerId,
      display_name: displayName,
      value_column: valueColumn,
      bounds,
      already_exists: false,
    };
  }
```

- [ ] **Step 3: Add `removeHexTileLayer` to `MapViewController`**

In `src/components/MapView.tsx`, add this method right after `addHexTileLayer`:

```typescript
  removeHexTileLayer(layerId: string):
    { success: true; layer_id: string }
    | { success: false; error: string } {
    if (typeof layerId !== 'string' || !layerId.startsWith('hex-')) {
      return { success: false, error: `layer_id '${layerId}' is not a hex layer (must start with 'hex-')` };
    }
    if (!this.layers.has(layerId)) {
      const hexLayers = [...this.layers.keys()].filter(id => id.startsWith('hex-'));
      return { success: false, error: `Unknown hex layer '${layerId}'. Registered: [${hexLayers.join(', ')}]` };
    }
    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    if (this.map.getSource(layerId)) this.map.removeSource(layerId);
    this.layers.delete(layerId);
    return { success: true, layer_id: layerId };
  }
```

- [ ] **Step 4: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MapView.tsx
git commit -m "feat(map): add/remove hex tile layer methods on MapViewController"
```

---

## Task 6: Add hex tile adapter methods

**Files:**
- Modify: `src/core/map-manager-adapter.ts`

The adapter is a thin pass-through: the controller already returns upstream's shape. We fire `onChange` after success so the Layers panel re-renders to show or remove the hex entry.

- [ ] **Step 1: Add `addHexTileLayer` / `removeHexTileLayer` to `MapManagerAdapter`**

In `src/core/map-manager-adapter.ts`, add these methods after `resetTooltip` (added in Task 4):

```typescript
  addHexTileLayer(opts: any) {
    const result = this.controller.addHexTileLayer(opts);
    if (result.success && !result.already_exists) this.options.onChange?.();
    return result;
  }

  removeHexTileLayer(layerId: string) {
    const result = this.controller.removeHexTileLayer(layerId);
    if (result.success) this.options.onChange?.();
    return result;
  }
```

The `any` on `opts` is intentional — `createMapTools()` calls this with the raw upstream args object, and we don't want to duplicate the option-type definition here. The controller's method has the precise type.

- [ ] **Step 2: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/map-manager-adapter.ts
git commit -m "feat(map): hex tile adapter methods"
```

---

## Task 7: Hex-aware UI guards in LayerPanel and LayerDetails

**Files:**
- Modify: `src/components/LayerPanel.tsx` (route remove through `removeHexTileLayer` for hex layers)
- Modify: `src/components/LayerDetails.tsx` (hide style / filter / filter-by-query sub-forms for hex layers; add an opacity slider for them)

Hex layers in `LayerDetails` currently fall into the `type === 'vector'` branch, which renders `SetStyleForm`, `SetFilterForm`, and `FilterByQueryForm`. The generated `fill-color` expression isn't meant for hand-editing, the hex MVT layer has no filterable user properties beyond `res`, and there's no useful `id_property` for filter-by-query. So for `kind === 'hex'` we render only the layer name + an opacity slider.

- [ ] **Step 1: Route hex remove in LayerPanel**

In `src/components/LayerPanel.tsx`, update the `removeLayer` callback:

```typescript
  const removeLayer = React.useCallback((layer: LayerState) => {
    if (!mapController) return;
    if (layer.kind === 'hex') {
      mapController.removeHexTileLayer(layer.id);
      recorder.record('remove_hex_tile_layer', { layer_id: layer.id });
    } else {
      mapController.removeLayer(layer.id);
      recorder.record('remove_layer', { layer_id: layer.id });
    }
    if (selectedId === layer.id) setSelectedId(null);
    forceUpdate();
  }, [mapController, recorder, selectedId]);
```

- [ ] **Step 2: Guard the sub-forms for hex layers in LayerDetails**

In `src/components/LayerDetails.tsx`, replace the three `layer.type === 'vector'` blocks with `layer.type === 'vector' && layer.kind !== 'hex'`. Specifically:

```tsx
      {layer.type === 'vector' && layer.kind !== 'hex' && (
        <SetStyleForm
          layer={layer}
          mapController={mapController!}
          recorder={recorder}
          onChange={onChange}
        />
      )}

      {layer.type === 'vector' && layer.kind !== 'hex' && (
        <SetFilterForm
          layer={layer}
          mapController={mapController!}
          recorder={recorder}
          onChange={onChange}
        />
      )}

      {layer.type === 'vector' && layer.kind !== 'hex' && mcpClient && (
        <FilterByQueryForm
          layer={layer}
          mapController={mapController!}
          recorder={recorder}
          mcpClient={mcpClient}
          onChange={onChange}
        />
      )}
```

- [ ] **Step 3: Add a hex-only opacity slider in LayerDetails**

In `src/components/LayerDetails.tsx`, immediately after the three guarded blocks above (before the raster block), insert a hex branch that reuses the existing `handleOpacity` callback:

```tsx
      {layer.kind === 'hex' && (
        <div className="jp-GeoAgent-field">
          <div className="jp-GeoAgent-field-label">
            <span>Opacity</span>
            <span>{layer.opacity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layer.opacity}
            onChange={handleOpacity}
          />
        </div>
      )}
```

`handleOpacity` calls `mapController.setOpacity(layer.id, v)`. Existing `MapViewController.setOpacity` (lines ~233–255) already handles the `state.type === 'vector'` case by setting `fill-opacity`, which is exactly what hex layers want — no controller change required.

- [ ] **Step 4: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LayerPanel.tsx src/components/LayerDetails.tsx
git commit -m "ui(layers): hex-aware guards for details forms and remove path"
```

---

## Task 8: Register the `register_hex_tiles` MCP passthrough

**Files:**
- Modify: `src/commands.ts`

Without this command, the LLM's `add_hex_tile_layer` flow ends up split across two MCP channels (panel + jupyter-ai), each with its own session and credentials. Adding it as a panel passthrough keeps the whole hex flow on one connection.

- [ ] **Step 1: Add `register_hex_tiles` to `registerMcpReadCommands`**

In `src/commands.ts`, inside `registerMcpReadCommands` (the function that already registers `browse_stac_catalog` / `get_stac_details` / `get_collection` / `query`), append another `registerMcpPassthrough(...)` call after the existing `query` registration:

```typescript
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
```

- [ ] **Step 2: Type-check + build**

Run: `jlpm build:lib`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/commands.ts
git commit -m "feat(commands): geoagent:register_hex_tiles MCP passthrough"
```

---

## Task 9: Full build + manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Run the full production build**

Run: `jlpm build:prod`
Expected: PASS. Builds `jupyter_geoagent/labextension/static/style.js` and friends.

- [ ] **Step 2: Install the extension into a dev jupyter lab**

Run:
```bash
pip install --editable . --group dev --group test
jupyter labextension develop --overwrite .
```

Expected: no errors. The extension is registered as `@geojupyter/jupyter-geoagent`.

- [ ] **Step 3: Smoke-test the tooltip path**

Start jupyter lab:
```bash
jupyter lab --no-browser
```

The JupyterLab command palette can't supply arbitrary args, so smoke-test by invoking commands from the browser DevTools console with the dev `jupyterapp` global. (If `window.jupyterapp` is undefined in your build, run `jupyter lab --dev-mode` or temporarily attach `(window as any).jupyterapp = app;` in `src/index.ts`'s activate function for the smoke run.)

In the browser at the printed URL:
1. Open the GeoAgent Map from the launcher.
2. Load the default STAC catalog. Pick any vector collection (e.g. `wdpa` or `cpad-holdings`) and add a PMTiles layer. Note the layer id shown in the Layers panel.
3. Open DevTools → Console. Run:
   ```javascript
   await jupyterapp.commands.execute('geoagent:set_tooltip', { layer_id: '<id>', fields: ['<a property name>'] })
   ```
4. Hover the map over a feature — the tooltip appears with the chosen property.
5. Run `await jupyterapp.commands.execute('geoagent:set_tooltip', { layer_id: '<id>', fields: [] })` — tooltip disabled, no hover popup.
6. Run `await jupyterapp.commands.execute('geoagent:reset_tooltip', { layer_id: '<id>' })` — tooltip restores to disabled (no defaults on this catalog layer).

Pass criteria: each call resolves to a JSON string containing `"success": true` (parse and inspect if needed), and the tooltip behaves as expected on hover.

- [ ] **Step 4: Smoke-test the hex tile path**

In DevTools Console:
1. Connect to the MCP server in the Query tab.
2. Run:
   ```javascript
   const reg = await jupyterapp.commands.execute('geoagent:register_hex_tiles', {
     sql: "SELECT h3_cell_to_parent(h8, 4) AS h4 FROM read_parquet('s3://public-data/<some-small-h3-dataset>.parquet') LIMIT 1000"
   });
   const r = JSON.parse(reg);
   console.log(r);
   ```
   (Pick any dataset with an h8/h7 column from the STAC catalog — a GBIF hex parquet is the canonical example.)
3. `r` contains `tile_url_template`, `value_columns`, `value_stats`, `bounds`, `layer_name`.
4. Run:
   ```javascript
   await jupyterapp.commands.execute('geoagent:add_hex_tile_layer', {
     tile_url: r.tile_url_template,
     value_column: 'count',
     value_stats: r.value_stats.count,
     bounds: r.bounds,
     layer_name: r.layer_name
   });
   ```
5. Map flies to the bounds; a colored hex grid renders. Layers panel shows a new entry whose id starts with `hex-`.
6. In the Layers panel: toggle visibility off → hexes disappear; on → reappear. Drag the opacity slider in the right-sidebar details → fill opacity updates live. Click "x" → layer removed via `removeHexTileLayer` (verify by re-clicking visibility had no orphaned source error).
7. Run `await jupyterapp.commands.execute('geoagent:remove_hex_tile_layer', { layer_id: '<a non-hex layer id>' })` — returns `{"success": false, "error": "layer_id '...' is not a hex layer ..."}`.

Pass criteria: all seven steps above behave as described, plus the Tool Call Log (Export tab → Export Tool Call Log) contains entries for `register_hex_tiles`, `add_hex_tile_layer`, and `remove_hex_tile_layer` with the args used.

- [ ] **Step 5: Confirm exports skip hex**

With the hex layer still present plus at least one catalog layer:
1. Export tab → Export `layers-input.json`. Verify the downloaded JSON's `collections[]` contains only the catalog layer, no `hex-` entry.
2. Export tab → Export Tool Call Log. Verify it contains the hex calls (recorder is unfiltered).

- [ ] **Step 6: Commit any cleanup**

If smoke-testing surfaced no issues, this task has no commit. If it surfaced issues, fix them and commit with a clear message; rerun the smoke from the failing step.

---

## Self-review

After Task 9, this checklist should all be true:

- [ ] Bumping the pin to `988b83e` is a single commit with `package.json` + `yarn.lock` only.
- [ ] `LayerState.kind` is set at every call site of `this.layers.set(...)` in `MapView.tsx`: `addLayer` → `catalog`, `addHexTileLayer` → `hex`. No other call sites exist.
- [ ] `ExportPanel.buildLayersInputConfig` filters by `kind === 'catalog'` before touching `datasetId`.
- [ ] `_wireTooltip` is called from `addLayer` (vector branch) and `addHexTileLayer`. Raster layers don't get tooltips.
- [ ] `MapManagerAdapter` exposes exactly the four new methods (`setTooltip`, `resetTooltip`, `addHexTileLayer`, `removeHexTileLayer`) so `createMapTools()` picks up upstream's new tools with no further wiring.
- [ ] `commands.ts` registers `geoagent:register_hex_tiles`. `SKIP_TOOLS` is unchanged.
- [ ] `LayerPanel.removeLayer` routes hex layers through `removeHexTileLayer`.
- [ ] `LayerDetails` hides `SetStyleForm` / `SetFilterForm` / `FilterByQueryForm` for hex layers and shows an opacity slider instead.
- [ ] `style/base.css` contains `.jp-GeoAgent-tooltip` styling.

If any are false, return to the relevant task and address before declaring the plan complete.
