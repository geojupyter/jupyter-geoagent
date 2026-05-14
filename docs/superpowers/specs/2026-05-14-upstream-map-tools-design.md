# Port new upstream geo-agent map tools

**Date:** 2026-05-14
**Repo:** `geojupyter/jupyter-geoagent`

## Problem

The `geo-agent` npm dependency is pinned at `bd724a5` (Nov 2025). Four new map tools have landed upstream since:

- `set_tooltip` / `reset_tooltip` (PR #196, `d191230`) — control which feature properties show in the hover tooltip for a vector layer.
- `add_hex_tile_layer` / `remove_hex_tile_layer` (PRs #51/#117 area, commits `e8cb529`, `297e2a5`, `013d803`, `6f04c47`) — render dynamic H3 hex MVT layers driven by the MCP `register_hex_tiles` tool.

Because `commands.ts` derives its JupyterLab command set from `createMapTools()` at runtime, the new tools will appear in the command registry as soon as the pin is bumped — but they will throw at call time because `MapManagerAdapter` and `MapViewController` do not implement the underlying primitives. The goal is to make all four tools fully functional from the LLM (jupyter-ai persona) channel.

## Goals

- All four upstream tools callable from the JupyterLab command channel and produce the upstream-defined `{success, ...}` return shape.
- Hex tile layers render correctly on the map, appear in the right-sidebar Layers panel with visibility / opacity / remove controls, and survive the existing tool-call-recording flow.
- Tooltips appear on hover for any layer (catalog or hex) whose `tooltipFields` is non-empty.
- Type-check (`tsc`) passes after the LayerState shape change.

## Non-goals

- Tooltip configuration UI in `LayerDetails` (LLM-only initially — matches upstream geo-agent UX).
- Hex layer participation in static HTML / `layers-input.json` exports. Hex layers are tied to a live, content-addressed MCP `register_hex_tiles` URL and are inherently ephemeral. The Tool Call Log captures `add_hex_tile_layer` and is replayable, which is sufficient.
- Style / filter controls in `LayerDetails` for hex layers (the per-resolution `fill-color` expression is generated and not meant for hand-editing through the existing forms).
- Backporting other upstream changes for their own sake. The pin bump pulls them in; we verify they don't break the adapter, but we don't deliberately consume them.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ LLM (jupyter-ai persona)                                       │
│   │ MCP execute_command                                        │
│   ▼                                                            │
│ commands.ts                                                    │
│   ├─ geoagent:set_tooltip      ─┐                              │
│   ├─ geoagent:reset_tooltip     │  via createMapTools()        │
│   ├─ geoagent:add_hex_tile_layer│  (upstream, no new wiring)   │
│   ├─ geoagent:remove_hex_tile_layer ┘                          │
│   └─ geoagent:register_hex_tiles  ← new MCP passthrough        │
│             │                                                  │
│             ▼                                                  │
│   MapManagerAdapter ─── new methods ──┐                        │
│             │                          │                       │
│             ▼                          ▼                       │
│   MapViewController.{setTooltip,  MCPClientWrapper             │
│                      resetTooltip,                             │
│                      addHexTileLayer,                          │
│                      removeHexTileLayer}                       │
│             │                                                  │
│             ▼                                                  │
│   MapLibre map + tooltip DOM element                           │
└────────────────────────────────────────────────────────────────┘
```

The pinned upstream commit moves from `bd724a5` to `988b83e` (HEAD as of 2026-05-12). `commands.ts` already loops over `createMapTools()` output and skips only `list_datasets`, `get_schema`, `set_projection`, so the four new tools are automatically registered as JupyterLab commands once the pin is bumped.

`hex-layer-helpers.js` is reused directly from the upstream package (`extractHashFromUrl`, `buildFillColorExpression`) — it has no DOM dependencies, so importing avoids duplication.

## Components

### `src/core/types.ts` — LayerState shape

- Add `tooltipFields?: string[] | null` (current state) and `defaultTooltipFields?: string[] | null` (config default for `reset_tooltip`).
- Add `kind: 'catalog' | 'hex'` discriminator. Existing call sites in `addLayer` set `kind: 'catalog'`; `addHexTileLayer` sets `kind: 'hex'`.
- Make `datasetId` and `assetId` optional (`datasetId?: string`, `assetId?: string`). Only catalog layers populate them; hex layers omit. All current readers in `LayerPanel`/`LayerDetails`/`ExportPanel` are audited for this change.
- `MapLayerConfig` gains an optional `tooltipFields?: string[]` so future catalog configs can seed defaults.

### `src/components/MapView.tsx` — controller and tooltip DOM

- The map container renders a sibling `<div className="jp-GeoAgent-tooltip">` with `position: absolute; display: none; pointer-events: none`. Its ref is captured at `onMapReady` time and passed to the `MapViewController` constructor.
- `MapViewController` gains:
  - Private `_tooltip: HTMLDivElement` field.
  - Private `_wireTooltip(mapLayerId, layerId)` — registers `mousemove`/`mouseleave` handlers on the named map layer that read `state.tooltipFields` at event time (so updates via `setTooltip` take effect immediately, no rebind needed).
  - Private `_formatTooltipValue(field, value)` — ports upstream's heuristic ($ for value/price/cost, comma-formatted for acres/area, raw otherwise).
  - `setTooltip(layerId, fields)` → returns `{success, layer, displayName, tooltipFields}` (matching upstream) or `{success: false, error}` for unknown / wrong-type / non-array inputs.
  - `resetTooltip(layerId)` → applies `state.defaultTooltipFields`, returns same shape.
  - `addHexTileLayer({tileUrl, valueColumn, valueStats, bounds, palette, opacity, displayName, fitBounds, layerName})` → validates the URL hash, idempotent on repeated calls with the same hash, builds the per-resolution `fill-color` expression, adds an MVT vector source + fill layer, registers a `LayerState` with `kind: 'hex'`, calls `_wireTooltip`, optionally `fitBounds`. Returns upstream's `{success, layer_id, display_name, value_column, bounds, already_exists}`.
  - `removeHexTileLayer(layerId)` → guards `hex-` prefix (refuses non-hex layers), removes layer + source, deletes state entry.
- `addLayer` is extended: read `config.tooltipFields`, seed `tooltipFields` / `defaultTooltipFields` on the new LayerState, and call `_wireTooltip(layerId, layerId)` after the fill layer is added. Outline layers don't need their own tooltip wiring.

### `src/core/map-manager-adapter.ts` — new wrapper methods

Four methods that delegate to the controller and fire `onChange` so the React Layers panel re-renders:

- `setTooltip(layerId, fields)` — pre-validates `state.type === 'vector'`, then passes through.
- `resetTooltip(layerId)` — same.
- `addHexTileLayer(opts)` — pass-through; the controller already returns upstream's shape.
- `removeHexTileLayer(layerId)` — pass-through.

The adapter does not need to translate return shapes for these four — they already match what `createMapTools()` expects.

### `src/commands.ts` — register_hex_tiles passthrough

Add `geoagent:register_hex_tiles` to `registerMcpReadCommands` alongside `query` / `get_collection`. Same shape as the other passthroughs: the LLM's call routes through the panel's `MCPClientWrapper`, so the whole hex flow uses one MCP connection.

Args schema, mirroring the MCP server's `register_hex_tiles` tool:

| name | type | required | default | notes |
|---|---|---|---|---|
| `sql` | string | yes | — | SELECT whose first column is an H3 index |
| `agg` | string | no | `"COUNT"` | aggregation at coarser pyramid levels |
| `min_res` | integer | no | `2` | coarsest H3 resolution in the pyramid |
| `finest_res` | integer | no | `null` | inferred from `sql` if omitted |
| `zoom_offset` | integer | no | `-1` | maps map zoom to H3 resolution |

The `usage` line is short — points the LLM at the "hex map / density / heatmap" trigger phrases — because the full upstream tool description (including the do-not-use rules) is returned with every call result, same as `query`.

### `src/components/LayerPanel.tsx`, `LayerDetails.tsx`

For `state.kind === 'hex'`:
- LayerPanel: render the visibility / opacity / remove controls only.
- LayerDetails: hide filter and style sub-forms entirely. Show only displayName and the per-layer remove action.

Remove button: route hex layers (`id.startsWith('hex-')` or `kind === 'hex'`) through `controller.removeHexTileLayer(layerId)`; everything else continues to use `controller.removeLayer(layerId)`. This avoids the source-cleanup mismatch between the two layer kinds (catalog layers carry a separate `sourceId`; hex layers share id with source).

### `src/components/ExportPanel.tsx`

When building `layers-input.json`, filter `controller.layers` to entries where `kind !== 'hex'`. Hex layers remain captured in the Tool Call Log (no change to the recorder — it appends every tool call already).

### `style/base.css`

Add a `.jp-GeoAgent-tooltip` rule (port of upstream's tooltip styling): absolute positioning, light background, small padding, table cells styled, hidden until shown.

## Data flow

**Tooltip set:**
1. LLM calls `geoagent:set_tooltip` with `{layer_id, fields: [...]}`.
2. `commands.ts` resolves the active panel, builds `MapManagerAdapter`, calls `createMapTools()` to get the tool, invokes `tool.execute(args)`.
3. The tool calls `adapter.setTooltip(layerId, fields)` → `controller.setTooltip(layerId, fields)` → mutates `state.tooltipFields`.
4. Next `mousemove` reads the new fields and renders the tooltip.

**Hex layer add:**
1. LLM calls `geoagent:register_hex_tiles` via the panel's MCP. Gets back `{tile_url_template, value_columns, value_stats, bounds, layer_name}`.
2. LLM calls `geoagent:add_hex_tile_layer` with those fields.
3. Adapter → controller. Controller builds the paint expression, adds source/layer, wires tooltip (with empty default fields), registers LayerState with `kind: 'hex'`.
4. `onChange` fires; Layers panel re-renders, showing the hex entry.

## Error handling

- Unknown `layer_id`: each method returns `{success: false, error: "Unknown layer: <id>. Available: ..."}` matching the existing adapter style.
- `set_tooltip` on a raster layer: returns `{success: false, error: "Tooltips only apply to vector layers; '<id>' is raster"}`.
- `set_tooltip` with non-array or non-string-array `fields`: returns `{success: false, error: "fields must be an array of strings"}`.
- `add_hex_tile_layer` with malformed `tile_url`: returns the upstream error (`"Invalid tile_url — expected template from register_hex_tiles ending in ..."`).
- `add_hex_tile_layer` with empty `value_stats.by_res`: returns the upstream error from `buildFillColorExpression`.
- `add_hex_tile_layer` on an existing hash: returns `{success: true, already_exists: true, message: "..."}` — idempotent.
- `remove_hex_tile_layer` on non-`hex-` id: returns `{success: false, error: "layer_id '...' is not a hex layer (must start with 'hex-')"}`.

## Testing

No automated test infrastructure exists in this repo. Verification is:

- `jlpm build` and `tsc` succeed (the LayerState shape change is the main type-check concern).
- Manual smoke in a running `jupyter lab` session:
  - Tooltip: load a catalog vector layer, run `geoagent:set_tooltip` from the command palette with two known property names, hover the map → tooltip renders. Empty array → tooltip disabled. `reset_tooltip` restores defaults (or disables if no defaults).
  - Hex: connect to MCP, run `geoagent:register_hex_tiles` with a small known SQL on H3 parquet data, copy the return fields into `geoagent:add_hex_tile_layer` → map renders + Layers panel shows the entry + opacity/visibility/remove all work + `geoagent:remove_hex_tile_layer` clears it.

## Risks

- **Upstream API drift between `bd724a5` and `988b83e`.** Three intermediate commits touch `app/map-manager.js` or `app/map-tools.js` in non-trivial ways:
  - `36db843` (set_style surfaces partial failures) — adapter's `setStyle` already returns the per-property `updates` array, so compatible.
  - `3ca96f8` / `d0e5220` (get_schema MCP delegate) — `get_schema` is in `SKIP_TOOLS`, no impact.
  - `4e4855c` / `6f04c47` (hex resolution handling) — only affects the hex tool surface we're adding fresh; no legacy adapter contract involved.
  Full diff of `app/map-tools.js` between pinned and target will be re-read before bumping to confirm no other adapter contract drift.
- **Tooltip DOM lifecycle vs. React.** The tooltip element must survive React re-renders. Mounting it inside the imperative map container (sibling of `<canvas>`) and capturing its ref at `onMapReady` time keeps React out of its lifecycle — same pattern the map container itself uses.
- **LayerState shape change blast radius.** Optional `datasetId` / `assetId` may surface non-null assertions in current code. Mitigated by `tsc --strict` (the repo's existing setting) catching every site.

## File changes summary

| File | Change |
|---|---|
| `package.json` | Bump `geo-agent` git ref from `bd724a5` to `988b83e` |
| `yarn.lock` | Regenerated |
| `src/core/types.ts` | LayerState: add `tooltipFields`, `defaultTooltipFields`, `kind`; `datasetId`/`assetId` optional. MapLayerConfig: optional `tooltipFields`. |
| `src/components/MapView.tsx` | Tooltip DOM + ref; new MapViewController methods; `addLayer` seeds tooltip fields + calls `_wireTooltip` |
| `src/core/map-manager-adapter.ts` | 4 new wrapper methods |
| `src/commands.ts` | `geoagent:register_hex_tiles` MCP passthrough |
| `src/components/LayerPanel.tsx` | `kind === 'hex'` guards; route remove through `removeHexTileLayer` |
| `src/components/LayerDetails.tsx` | Hide filter/style sub-forms for hex layers |
| `src/components/ExportPanel.tsx` | Filter out hex layers from `layers-input.json` |
| `style/base.css` | `.jp-GeoAgent-tooltip` rule |
