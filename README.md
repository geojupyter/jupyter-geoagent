# jupyter-geoagent

A JupyterLab extension for interactive geospatial data exploration via STAC catalogs and MCP-powered queries.

Click **GeoAgent Map** in the JupyterLab launcher to open a GUI-driven map explorer — no code required. Browse STAC catalogs, add layers, style and filter data, run DuckDB spatial queries, and export reproducible artifacts.

## Features

- **STAC catalog browser** — enter a catalog URL, browse collections, add layers to the map
- **MapLibre GL JS map** — interactive map with multiple basemaps, zoom, pan, rotate
- **Layer management** — toggle visibility, remove layers
- **MCP query interface** — run SQL queries against parquet data via a remote DuckDB server
- **Reproducible exports** — export as static HTML map, geo-agent `layers-input.json`, or a tool call log

## Install

```bash
pip install jupyter-geoagent
```

## Development

```bash
# Clone and install in dev mode
pip install --editable . --group dev --group test --group docs

# Link the extension for development
jupyter labextension develop --overwrite .

# Watch for changes (in two terminals)
jlpm watch:src
jupyter lab --no-browser
```

## Documentation

- **User guide:** how to use the extension day-to-day. Published at <https://jupyter-geoagent.readthedocs.io/> or read the source at [docs/usage.md](docs/usage.md).
- **Design specification:** architecture and module reuse reference for contributors at [docs/design.md](docs/design.md).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development
setup and the pull request process. By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Citation

If you use `jupyter-geoagent` in your work, please cite it. Citation metadata is
available in [CITATION.cff](CITATION.cff), and GitHub's "Cite this repository"
button renders it in APA and BibTeX. Archived releases are available on Zenodo.
