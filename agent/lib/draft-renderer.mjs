// Use the pinned managed renderer and layout; the host supplies the skill's font.
import { renderPng, renderSvg } from "../skills/gtm-workflow/templates/lib/diagram-svg.ts";
import { layoutGraph } from "../skills/gtm-workflow/templates/lib/layout.ts";

export function renderDraft(graph, font) {
  return renderPng(renderSvg(layoutGraph(graph)), font);
}
