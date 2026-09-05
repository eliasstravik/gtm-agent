# Eve 0.49.1 compatibility patch

Eve's authored workflow discovery scans the application root for `use step`
and `use workflow` directives. This also discovers the vendored GTM workflow
templates under `agent/skills/`, registering their steps in the agent executable
and importing database dependencies that belong to generated workflow projects.
The build succeeds, but the deployed agent fails to start with
`ERR_MODULE_NOT_FOUND: drizzle-orm`.

The patch stops discovery inside directories containing `SKILL.md`. Their source
files remain available as skill assets. Authored step modules outside skill
directories remain discoverable. No vendored skill files are modified.

`tests/workflow-discovery.test.mjs` exercises the installed Eve implementation
against this repository and an isolated fixture. Reassess this patch when
upgrading Eve; remove it when upstream discovery excludes skill assets.
