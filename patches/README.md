# Eve workflow discovery

Eve's authored workflow discovery scans the application root for `use step`
and `use workflow` directives. This also discovers the vendored GTM workflow
templates under `agent/skills/`, registering their steps in the agent executable
and importing database dependencies that belong to generated workflow projects.
The build succeeds, but the deployed agent fails to start with
`ERR_MODULE_NOT_FOUND: drizzle-orm`.

Eve 0.52.3 switched to bundling workflows reachable from the agent. The 0.52.5
upgrade removes the application-root scanner and the 0.49.1 patch. Vendored
templates remain skill assets and require no patch.

`tests/workflow-discovery.test.mjs` verifies reachable authored steps and excluded
skill assets against the installed Eve compiler.
