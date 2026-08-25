#  Relationship to GLEN

This package depends on another package, [`GLEN` (repository rename
pending)](https://github.com/boettiger-lab/geo-agent) to provide tool definitions and an
MCP client for data interaction.

**We may refactor to remove our dependency on `GLEN`**.


## Dependency definition

`GLEN` is defined as a dependency in `package.json`.
`GLEN` is not packaged on <npmjs.com>, instead it's defined as a Git dependency.


## Tools

`GLEN` provides tool definitions, but JupyterAI doesn't know how to find those tools.

To expose those tools to JupyterAI, we wrap the tools as Jupyter Commands in
`src/commands.ts`.


### TODO

In `src/commands.ts` there are a few code quirks that we should refactor, clean up, or
explain in comments.

* We call `GLEN`'s `createMapTools` function once to get all the tools, and again for
  each tool. Why are we doing this?
* We assign the result of the first `createMapTools` call to `toolMetadata`. We have a
  modules `tool-metadata.ts` which provides `getToolMetadata` -- by name, this seems
  like the thing we should be calling to create a variable named `toolMetadata`. Why are
  we doing this the way we are?


## MCP

TODO:

* What _is_ the MCP server (URL, Git repository)?
* What does it do? (DuckDB stuff, ??)
* How is it deployed (NRP)
* ?
