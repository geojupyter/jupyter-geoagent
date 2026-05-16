/**
 * LayerDetails — detail pane rendered at the bottom of the LayerPanel
 * when a layer is selected. Exposes per-layer config: version switcher,
 * SetStyleForm, SetFilterForm (vector), opacity slider, colormap, and
 * rescale (raster). Vector opacity is edited via the Style form's
 * fill-opacity key rather than a dedicated slider.
 */

import * as React from 'react';
import { LayerState } from '../core/types';
import { MapViewController } from './MapView';
import { ToolCallRecorder } from '../core/tools';
import { MCPClientWrapper } from '../core/mcp';
import { SetFilterForm } from './tool-forms/SetFilterForm';
import { SetStyleForm } from './tool-forms/SetStyleForm';
import { FilterByQueryForm } from './tool-forms/FilterByQueryForm';

export interface LayerDetailsProps {
  layer: LayerState;
  mapController: MapViewController | null;
  recorder: ToolCallRecorder;
  mcpClient?: MCPClientWrapper | null;
  /** Fired after any control change so the parent can re-read layer state. */
  onChange: () => void;
}

export const LayerDetails: React.FC<LayerDetailsProps> = ({
  layer,
  mapController,
  recorder,
  mcpClient,
  onChange,
}) => {
  // Rescale is a "min,max" string on LayerState; split for the two inputs.
  const [rescaleMin, rescaleMax] = React.useMemo(() => {
    if (!layer.rescale) return ['', ''];
    const [a, b] = layer.rescale.split(',');
    return [a ?? '', b ?? ''];
  }, [layer.rescale]);

  const [minInput, setMinInput] = React.useState(rescaleMin);
  const [maxInput, setMaxInput] = React.useState(rescaleMax);

  React.useEffect(() => {
    setMinInput(rescaleMin);
    setMaxInput(rescaleMax);
  }, [rescaleMin, rescaleMax, layer.id]);

  const applyRescale = () => {
    if (!mapController) return;
    const trimmedMin = minInput.trim();
    const trimmedMax = maxInput.trim();
    const rescale = (trimmedMin && trimmedMax) ? `${trimmedMin},${trimmedMax}` : undefined;
    mapController.setRescale(layer.id, rescale);
    recorder.record('set_rescale', { layer_id: layer.id, rescale: rescale ?? null });
    onChange();
  };

  const handleColormap = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cm = e.target.value;
    if (!mapController) return;
    mapController.setColormap(layer.id, cm);
    recorder.record('set_colormap', { layer_id: layer.id, colormap: cm });
    onChange();
  };

  const handleVersionSwitch = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    if (!mapController || isNaN(idx)) return;
    mapController.switchVersion(layer.id, idx);
    recorder.record('switch_version', {
      layer_id: layer.id,
      version_index: idx,
      version_label: layer.versions?.[idx]?.label,
    });
    onChange();
  };

  const COLORMAPS = [
    'viridis', 'plasma', 'inferno', 'magma', 'cividis',
    'turbo', 'reds', 'blues', 'greens', 'greys',
    'ylgnbu', 'ylorrd', 'rdylgn', 'spectral',
  ];

  const handleOpacity = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!mapController) return;
    mapController.setOpacity(layer.id, v);
    recorder.record('set_opacity', { layer_id: layer.id, opacity: v });
    onChange();
  };

  return (
    <div className="jp-GeoAgent-layer-details">
      <h4>Layer Details</h4>
      <div className="jp-GeoAgent-layer-details-name">{layer.displayName}</div>

      {layer.versions && layer.versions.length > 1 && (
        <div className="jp-GeoAgent-field">
          <div className="jp-GeoAgent-field-label">
            <span>Version</span>
          </div>
          <select
            className="jp-GeoAgent-input"
            value={layer.currentVersionIndex ?? 0}
            onChange={handleVersionSwitch}
          >
            {layer.versions.map((v, i) => (
              <option key={v.assetId} value={i}>{v.label}</option>
            ))}
          </select>
        </div>
      )}

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

      {layer.type === 'raster' && (
        <>
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

          <div className="jp-GeoAgent-field">
            <div className="jp-GeoAgent-field-label">
              <span>Colormap</span>
            </div>
            <select
              className="jp-GeoAgent-input"
              value={layer.colormap ?? 'reds'}
              onChange={handleColormap}
            >
              {COLORMAPS.map(cm => (
                <option key={cm} value={cm}>{cm}</option>
              ))}
            </select>
          </div>

          <div className="jp-GeoAgent-field">
            <div className="jp-GeoAgent-field-label">
              <span>Rescale (min, max)</span>
            </div>
            <div className="jp-GeoAgent-field-row">
              <input
                type="number"
                className="jp-GeoAgent-input"
                value={minInput}
                placeholder="min"
                onChange={e => setMinInput(e.target.value)}
              />
              <input
                type="number"
                className="jp-GeoAgent-input"
                value={maxInput}
                placeholder="max"
                onChange={e => setMaxInput(e.target.value)}
              />
              <button className="jp-GeoAgent-button jp-GeoAgent-button-small" onClick={applyRescale}>
                Apply
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
};
