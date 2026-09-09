# Workflow capabilities

The workflow skill selects ordinary steps, durable agent stages, or a mixture from business intent. `/gtm-workflows` is recognized by the existing `gtm-workflow` skill. The full authoring contract ships with the [vendored capability reference](../agent/skills/gtm-workflow/references/capabilities.md).

An agent stage executes in the workspace's workflow project using its own selected tools and committed skill content. It does not reuse this Eve app's model credentials, MCP connections, browser, or authoring sandbox. The sandbox keeps its existing egress and credential restrictions.

The run preview includes each agent's selected skills, tools, fixed arguments, destinations, effects, call limits, spending limit, deadline, and estimated-cost flag. Start requires the preview's capability hash for these workflows. The host repeats the preview and refuses a changed definition. Existing ordinary workflows retain their current start contract.

The `trigger` operation sends approved callback data to an existing waiting run through the protected workflow route. Permanent event sources instead live in the workflow project's committed registry and signed intake route. Enabling or disabling a source uses the existing reviewed workspace-save process, with Git-connected deployment and no additional control database.

After this agent update, an existing workspace still needs the workflow skill's generation-17 runtime update before using the new helpers. Preserve workflow-owned definitions, event sources, and provider adapters during that update. This release requires no new database schema. Model/MCP/browser credentials and calendar subscriptions are configured separately in the workflow deployment when a concrete automation is requested.

The template does not provision a coding-agent execution environment. The capability reference records the current workflow-harness peer-version mismatch and the required compatibility test for such an extension.
