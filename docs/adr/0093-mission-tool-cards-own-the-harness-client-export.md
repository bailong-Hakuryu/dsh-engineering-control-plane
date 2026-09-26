---
status: accepted
---

# Mission tool cards own the Harness client export

Harness Web showed every Mission tool call as a generic row: a generic title, the raw tool name, raw JSON arguments, and a raw JSON result. Every supported Harness version serves a package's `./client` export to the browser when an enabled Loader row names the package exactly and its manifest declares `dsh.client` with `platform: "web"`; the served file must be the loader's lazy-CJS factory artifact, and a keyed `tool.call.toolview` slot renders one view per wire tool name. That reserved path was already taken by the browser-safe projection cache, so the projection cache moves to `./projection` and `./client` becomes the Mission card bundle.

Each card is a pure function of one tool-call block, so live sessions and replayed history render alike: a one-line title and summary with status, gate, and blocked-reason chips that expands into branch, roles, assurance outcomes, and available actions. Cards call no Service, hold no authority, render text only through React text nodes, and use only Harness theme tokens present in every supported version. Harness publishes no bundling preset outside its repository, so a dependency-free build step transpiles each card module with the project's TypeScript, links them through a private module table inside the factory, and fails when a module imports anything other than `react`, which the page's module table provides.

The package's own tests evaluate the built factory with a stub loader and React to prove it registers exactly the five Mission views and requests only `react`; the packed profile smoke asserts that a real Harness Web boot graph lists and serves the bundle. A Harness change to the client module system, the toolview slot, or the tool-call block shape requires a compatibility review before admission.
