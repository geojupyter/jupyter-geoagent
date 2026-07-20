# Contributing to jupyter-geoagent

Thanks for your interest in contributing! `jupyter-geoagent` is a JupyterLab
extension for interactive geospatial data exploration via STAC catalogs and
MCP-powered queries. Contributions of all kinds are welcome — bug reports,
documentation, feature ideas, and code.

By participating in this project you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs** or request features by opening an
  [issue](https://github.com/geojupyter/jupyter-geoagent/issues).
- **Improve the docs** in [`docs/`](docs/) — the user guide (`docs/usage.md`)
  and design spec (`docs/design.md`).
- **Fix bugs or add features** by opening a pull request.

Before starting significant work, please open an issue to discuss the approach
so we can avoid duplicated effort.

## Development setup

This is a hybrid Python + TypeScript JupyterLab extension. You'll need Python
>=3.10, Node.js, and JupyterLab >=4.5.

```bash
# Clone your fork
git clone https://github.com/<your-username>/jupyter-geoagent.git
cd jupyter-geoagent

# Install in editable mode with dev, test, and docs dependencies
pip install --editable . --group dev --group test --group docs

# Link the extension for development
jupyter labextension develop --overwrite .

# Watch for changes (in two terminals)
jlpm watch:src
jupyter lab --no-browser
```

Rebuild the TypeScript after edits (or rely on `jlpm watch:src`), then refresh
JupyterLab in your browser to pick up changes.

## Running tests

```bash
# Python tests
python -m pytest
```

## Code style and pre-commit

This project uses [pre-commit](https://pre-commit.com/) to enforce formatting
and linting. Please install and run the hooks before committing:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Pull request process

1. Fork the repository and create a topic branch off `main`.
2. Make your change, adding tests and documentation where appropriate.
3. Ensure `pre-commit run --all-files` and the test suite pass.
4. Write a clear PR description explaining the motivation and the change.
5. Reference any related issues (e.g. `Fixes #123`).

A maintainer will review your PR. Please be responsive to review feedback —
we aim to keep the process quick and friendly.

## License

By contributing, you agree that your contributions will be licensed under the
[BSD 3-Clause License](LICENSE) that covers the project.
