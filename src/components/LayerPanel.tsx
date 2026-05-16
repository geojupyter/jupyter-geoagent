/**
 * LayerPanel — shows active map layers with visibility, opacity, and remove controls.
 *
 * Clicking a row selects it; the selected layer's details render in the
 * LayerDetails pane at the bottom.
 */

import * as React from 'react';
import { MapViewController } from './MapView';
import { LayerState } from '../core/types';
import { ToolCallRecorder } from '../core/tools';
import { MCPClientWrapper } from '../core/mcp';
import { LayerDetails } from './LayerDetails';

export interface LayerPanelProps {
  mapController: MapViewController | null;
  recorder: ToolCallRecorder;
  /** Increment this to force re-render when layers change externally */
  refreshKey: number;
  /**
   * External request to reveal a specific layer's details (e.g. after a
   * dataset was added from the catalog). The seq counter ensures the
   * effect fires even if the same id is queued twice in a row.
   */
  pendingSelection?: { id: string; seq: number } | null;
  mcpClient?: MCPClientWrapper | null;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  mapController,
  recorder,
  refreshKey,
  pendingSelection,
  mcpClient,
}) => {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // External selection requests (e.g. "the dataset just added") win over
  // whatever the user last clicked.
  React.useEffect(() => {
    if (pendingSelection) setSelectedId(pendingSelection.id);
  }, [pendingSelection]);

  const layers = React.useMemo(() => {
    if (!mapController) return [];
    return [...mapController.layers.values()].reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapController, refreshKey]);

  // Drop the selection if the selected layer has been removed.
  React.useEffect(() => {
    if (selectedId && !layers.find(l => l.id === selectedId)) {
      setSelectedId(null);
    }
  }, [layers, selectedId]);

  const toggleVisibility = React.useCallback((layer: LayerState) => {
    if (!mapController) return;
    if (layer.visible) {
      mapController.hideLayer(layer.id);
      recorder.record('hide_layer', { layer_id: layer.id });
    } else {
      mapController.showLayer(layer.id);
      recorder.record('show_layer', { layer_id: layer.id });
    }
    forceUpdate();
  }, [mapController, recorder]);

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

  const selectedLayer = selectedId ? layers.find(l => l.id === selectedId) ?? null : null;

  if (layers.length === 0) {
    return (
      <div className="jp-GeoAgent-layers">
        <h3>Layers</h3>
        <p className="jp-GeoAgent-empty">No layers added yet. Browse the STAC catalog to add data.</p>
      </div>
    );
  }

  return (
    <div className="jp-GeoAgent-layers">
      <h3>Layers</h3>
      <ul className="jp-GeoAgent-layer-list">
        {layers.map(layer => (
          <li
            key={layer.id}
            className={
              'jp-GeoAgent-layer-item' +
              (layer.id === selectedId ? ' jp-GeoAgent-layer-item-selected' : '')
            }
            onClick={() => setSelectedId(layer.id)}
          >
            <div className="jp-GeoAgent-layer-header">
              <label
                className="jp-GeoAgent-layer-toggle"
                onClick={e => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => toggleVisibility(layer)}
                />
                <span>{layer.displayName}</span>
              </label>
              <button
                onClick={e => { e.stopPropagation(); removeLayer(layer); }}
                className="jp-GeoAgent-button-icon"
                title="Remove layer"
              >
                x
              </button>
            </div>
            <div className="jp-GeoAgent-layer-meta">
              <span className="jp-GeoAgent-layer-type">{layer.type}</span>
              <span className="jp-GeoAgent-layer-id">{layer.id}</span>
            </div>
          </li>
        ))}
      </ul>

      {selectedLayer && (
        <LayerDetails
          layer={selectedLayer}
          mapController={mapController}
          recorder={recorder}
          mcpClient={mcpClient}
          onChange={forceUpdate}
        />
      )}
    </div>
  );
};
