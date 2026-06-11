/**
 * ExportPanel — export the current map state as reproducible artifacts.
 *
 * Three export formats:
 *   1. Static HTML — self-contained MapLibre map
 *   2. layers-input.json — geo-agent web app config
 *   3. Tool call log — JSON record of all actions
 */

import * as React from 'react';
import { MapViewController } from './MapView';
import { ToolCallRecorder } from '../core/tools';
import { LayersInputConfig } from '../core/types';

export interface ExportPanelProps {
  mapController: MapViewController | null;
  recorder: ToolCallRecorder;
  catalogUrl: string;
  titilerUrl: string;
}

function downloadJson(data: any, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildLayersInputConfig(
  mapController: MapViewController,
  catalogUrl: string,
  titilerUrl: string,
): LayersInputConfig {
  const viewState = mapController.getViewState();
  const layers = [...mapController.layers.values()].filter(l => l.kind === 'catalog');

  const datasetLayers = new Map<string, string[]>();
  for (const layer of layers) {
    const existing = datasetLayers.get(layer.datasetId) || [];
    existing.push(layer.id.split('/')[1]);
    datasetLayers.set(layer.datasetId, existing);
  }

  const collections: LayersInputConfig['collections'] = [];
  for (const [datasetId, assetIds] of datasetLayers) {
    collections.push({
      collection_id: datasetId,
      assets: assetIds.map(id => ({
        id,
        visible: mapController.layers.get(`${datasetId}/${id}`)?.visible ?? false,
      })),
    });
  }

  return {
    catalog: catalogUrl,
    titiler_url: titilerUrl,
    view: viewState,
    collections,
  };
}

export const ExportPanel: React.FC<ExportPanelProps> = ({
  mapController,
  recorder,
  catalogUrl,
  titilerUrl,
}) => {
  const exportToolLog = React.useCallback(() => {
    const log = recorder.export();
    downloadJson(log, 'tool-calls.json');
  }, [recorder]);

  const exportLayersInput = React.useCallback(() => {
    if (!mapController) return;
    const config = buildLayersInputConfig(mapController, catalogUrl, titilerUrl);
    downloadJson(config, 'layers-input.json');
  }, [mapController, catalogUrl, titilerUrl]);

  const exportStaticHtml = React.useCallback(() => {
    if (!mapController) return;

    const viewState = mapController.getViewState();
    const layers = mapController.getVisibleLayers();

    // Build a minimal MapLibre style with the current visible layers
    const sources: Record<string, any> = {
      natgeo: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
      },
    };
    const styleLayers: any[] = [
      { id: 'basemap', type: 'raster', source: 'natgeo' },
    ];

    for (const layer of layers) {
      const sourceId = layer.sourceId;
      if (!sources[sourceId]) {
        // Reconstruct the source from what we know
        const mapSource = mapController.map.getSource(sourceId);
        if (mapSource) {
          sources[sourceId] = (mapSource as any).serialize?.() || { type: 'raster' };
        }
      }

      const mapLayer = mapController.map.getLayer(layer.id);
      if (mapLayer) {
        styleLayers.push({
          id: layer.id,
          type: (mapLayer as any).type,
          source: sourceId,
          ...(layer.sourceLayer ? { 'source-layer': layer.sourceLayer } : {}),
          paint: layer.currentStyle ?? layer.defaultStyle ?? {},
          ...(layer.filter ? { filter: layer.filter } : {}),
        });
      }
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GeoAgent Map Export</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/maplibre-gl@5.2.0/dist/maplibre-gl.js"></script>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.2.0/dist/maplibre-gl.css">
  <script src="https://unpkg.com/pmtiles@3.0.7/dist/pmtiles.js"></script>
  <style>body{margin:0}#map{width:100vw;height:100vh}</style>
</head>
<body>
  <div id="map"></div>
  <script>
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: ${JSON.stringify(sources, null, 2)},
        layers: ${JSON.stringify(styleLayers, null, 2)}
      },
      center: ${JSON.stringify(viewState.center)},
      zoom: ${viewState.zoom},
      bearing: ${viewState.bearing},
      pitch: ${viewState.pitch}
    }).addControl(new maplibregl.NavigationControl());
  </script>
</body>
</html>`;

    downloadHtml(html, 'map-export.html');
  }, [mapController]);

  const exportStandaloneApp = React.useCallback(async () => {
    if (!mapController) return;

    const config = buildLayersInputConfig(mapController, catalogUrl, titilerUrl);

    // Build index.html — geo-agent CDN template that reads layers-input.json
    // When placed next to layers-input.json and served over HTTP, geo-agent's
    // main.js loads the config and renders the full map with all layers.
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GeoAgent Map</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/boettiger-lab/geo-agent@main/app/chat.css">
</head>
<body>
  <script type="module" src="https://cdn.jsdelivr.net/gh/boettiger-lab/geo-agent@main/app/main.js"><\/script>
</body>
</html>`;

    // Download both files
    downloadJson(config, 'layers-input.json');
    downloadHtml(indexHtml, 'index.html');
  }, [mapController, catalogUrl, titilerUrl]);

  return (
    <div className="jp-GeoAgent-export">
      <h3>Export</h3>

      <div className="jp-GeoAgent-export-actions">
        <button
          onClick={exportStaticHtml}
          disabled={!mapController}
          className="jp-GeoAgent-button"
        >
          Export Static HTML Map
        </button>

        <button
          onClick={exportLayersInput}
          disabled={!mapController}
          className="jp-GeoAgent-button"
        >
          Export layers-input.json
        </button>

        <button
          onClick={exportToolLog}
          disabled={recorder.length === 0}
          className="jp-GeoAgent-button"
        >
          Export Tool Call Log ({recorder.length} calls)
        </button>

        <button
          onClick={exportStandaloneApp}
          disabled={!mapController}
          className="jp-GeoAgent-button"
        >
          Export Standalone App
        </button>
      </div>
    </div>
  );
};
