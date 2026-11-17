import type { CinderInferGraphNodeDetail, InferIntentRequest } from "@cinder/shared";

/**
 * The request carries a flat list of real KEYS per node type (see CinderInferGraphSummary) -
 * these remain the ONLY thing the final answer is validated against (see
 * normalizeInferResponseToIntent in packages/cinder/src/core/ai/llmCore.ts), so grounding here
 * is defense in depth, not the only safety net, same as before.
 *
 * Additionally, when the client sends `graph.nodeDetails` (real labels + page-section
 * breadcrumbs for those same keys - see CinderInferGraphNodeDetail's doc comment in
 * @cinder/shared), the prompt below renders a much richer per-candidate description instead of
 * bare keys. Found necessary by real testing (docs/known-limitations.md): a bare key like
 * "dashboard-tile-disbursed-count" carries no signal to tell it apart from
 * "dashboard-tile-disbursed-amount," while their real labels ("Loans disbursed: open the list"
 * vs. "Amount disbursed: open the list") make the distinction obvious. This is purely additive -
 * older clients that don't send nodeDetails still get the original bare-key-list format.
 */
const SYSTEM_PROMPT = `You are the tier-3 fallback for Cinder, a semantic command engine for websites and apps. A local, deterministic engine and a client-side embedding model already tried and failed to resolve the user's request - you are the last resort before giving up.

You will be given the user's exact text, plus every route/context/entity/field/filter/action/output currently available on the page - each with its real key and, where available, its real human-facing label and where it sits in the page (its section breadcrumb and/or the route it belongs to). Use the label and page-section information to tell apart candidates that sound similar or share words - that is exactly what they are there for. But the KEY is what you must answer with, and it must be one of the EXACT keys given to you. You must never invent a key that isn't in the lists given to you, even if it seems like an obvious name for what the user wants - if the right target genuinely isn't listed, that's a sign to decline, not to guess at what it might be called.

If two or more real candidates are genuinely indistinguishable from the user's text alone - for example, several differently-purposed controls that are all just labeled "Save," or a request that could equally mean several same-section tiles - decline rather than guess. A wrong confident answer here has nowhere left to fall back to; an honest "I don't know" does not.

Respond with ONLY a single JSON object (no markdown fences, no prose before or after), matching this shape:
{
  "intent": "navigate" | "trigger_action" | "set_field" | "set_filter" | "show_output" | "composite_flow" | null,
  "target": "<one of the exact keys given to you>",
  "entities": { "value": <only for set_field/set_filter - the value to set, as a string> },
  "confidence": <number 0-1, your genuine confidence this is correct>,
  "steps": [ { "type": "navigate"|"trigger_action"|"set_field"|"set_filter"|"show_output"|"search", "target": "<exact key>", "value": <optional> }, ... ],
  "reply": "<a short, optional human-readable sentence, only if it adds real value>"
}

"steps" is for a composite_flow (the user asked for more than one thing, or a flow that needs several real steps to accomplish) - omit it for a single-step intent, where "target" (and "entities.value" for set_field/set_filter) alone is enough.

If nothing in the given candidate lists plausibly matches what the user is asking for, respond with exactly: {"intent": null, "confidence": 0}. An honest "I don't know" is always better than a wrong guess - a confident wrong answer here has nowhere left to fall back to.`;

function formatKeyList(label: string, keys?: string[]): string {
  if (!keys || keys.length === 0) {
    return `${label}: (none on this page)`;
  }

  return `${label}: ${keys.join(", ")}`;
}

function formatDetailLine(detail: CinderInferGraphNodeDetail): string {
  const where: string[] = [];

  if (detail.routeKey) {
    where.push(`page: ${detail.routeKey}`);
  }

  if (detail.contextPath && detail.contextPath.length > 0) {
    where.push(`section: ${detail.contextPath.join(" > ")}`);
  }

  if (detail.navigatesTo) {
    where.push(`navigates to: ${detail.navigatesTo}`);
  }

  const labelPart = detail.label ? ` - "${detail.label}"` : "";
  const wherePart = where.length > 0 ? ` (${where.join(", ")})` : "";

  return `  - ${detail.key}${labelPart}${wherePart}`;
}

function formatDetailGroup(label: string, type: string, details: CinderInferGraphNodeDetail[]): string {
  const matching = details.filter((detail) => detail.type === type);

  if (matching.length === 0) {
    return `${label}: (none on this page)`;
  }

  return `${label}:\n${matching.map(formatDetailLine).join("\n")}`;
}

export function buildCloudPrompt(request: InferIntentRequest): { system: string; user: string } {
  const graph = request.graph;
  const nodeDetails = graph?.nodeDetails;
  const lines: string[] = [];

  lines.push(`User's request: "${request.text}"`);

  if (request.app?.name) {
    lines.push(`App: ${request.app.name}${request.app.version ? ` v${request.app.version}` : ""}`);
  }

  if (graph?.activeRoute) {
    lines.push(`Currently on route: ${graph.activeRoute}`);
  }

  if (graph?.activeContext) {
    lines.push(`Currently in context: ${graph.activeContext}`);
  }

  lines.push("");

  if (nodeDetails && nodeDetails.length > 0) {
    lines.push("Real candidates available right now (the key is the ONLY valid target - label and page/section are context to help you choose):");
    lines.push(formatDetailGroup("Routes", "route", nodeDetails));
    lines.push(formatDetailGroup("Actions", "action", nodeDetails));
    lines.push(formatDetailGroup("Fields", "field", nodeDetails));
    lines.push(formatDetailGroup("Filters", "filter", nodeDetails));
    lines.push(formatDetailGroup("Outputs", "output", nodeDetails));
    lines.push(formatDetailGroup("Entities", "entity", nodeDetails));
    lines.push(formatDetailGroup("Data sources", "data", nodeDetails));

    const contextDetails = nodeDetails.filter((detail) => detail.type === "context");
    if (contextDetails.length > 0) {
      lines.push(formatDetailGroup("Contexts", "context", nodeDetails));
    }
  } else {
    lines.push("Real candidate keys available right now (these are the ONLY valid targets):");
    lines.push(formatKeyList("Routes", graph?.routes));
    lines.push(formatKeyList("Actions", graph?.actions));
    lines.push(formatKeyList("Fields", graph?.fields));
    lines.push(formatKeyList("Filters", graph?.filters));
    lines.push(formatKeyList("Outputs", graph?.outputs));
    lines.push(formatKeyList("Entities", graph?.entities));
    lines.push(formatKeyList("Data sources", graph?.dataSources));

    if (graph?.contexts && graph.contexts.length > 0) {
      lines.push(formatKeyList("Contexts", graph.contexts));
    }
  }

  if (request.context && Object.keys(request.context).length > 0) {
    lines.push("");
    lines.push(`Additional context: ${JSON.stringify(request.context)}`);
  }

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}
