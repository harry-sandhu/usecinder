// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderDispatchResult,
  CinderReflexHandler,
  CinderReflexOptions,
  CinderReflexResult,
  CinderResolvedIntent,
} from "../../types.js";

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSuccessMessage(intent: CinderResolvedIntent): string {
  switch (intent.intent) {
    case "navigate":
      return `Opening ${intent.target ?? "that route"}.`;
    case "trigger_action":
      return `Running ${intent.target ?? "that action"}.`;
    case "set_field":
      return `Set ${intent.target ?? "that field"} to ${String(intent.value ?? "")}.`;
    case "set_filter":
      return `Set ${intent.target ?? "that filter"} to ${String(intent.value ?? "")}.`;
    case "show_output":
      return `Showing ${intent.target ?? "that output"}.`;
    case "composite_flow":
      return `Applied the requested flow for ${intent.target ?? "the current context"}.`;
    default:
      return `Completed ${intent.intent}.`;
  }
}

function formatClarificationMessage(intent: CinderResolvedIntent): string {
  if (intent.intent === "unknown") {
    return "I couldn't match that to a local action.";
  }

  return "I need a little more context to complete that request.";
}

function formatFailureMessage(
  intent: CinderResolvedIntent,
  dispatch?: CinderDispatchResult,
): string {
  const prefix = intent.target
    ? `I found ${intent.target}, but couldn't complete the request.`
    : "I found a likely match, but couldn't complete the request.";

  if (!dispatch || dispatch.errors.length === 0) {
    return prefix;
  }

  return `${prefix} ${sentenceCase(dispatch.errors[0] ?? "")}`;
}

function buildReflexResult(
  intent: CinderResolvedIntent,
  dispatch?: CinderDispatchResult,
): Omit<CinderReflexResult, "spoken"> {
  if (intent.intent === "unknown") {
    return {
      ok: false,
      kind: "clarification",
      message: formatClarificationMessage(intent),
      intent,
      dispatch,
    };
  }

  if (!dispatch) {
    return {
      ok: true,
      kind: "info",
      message: sentenceCase(intent.intent),
      intent,
    };
  }

  if (dispatch.ok) {
    return {
      ok: true,
      kind: "success",
      message: formatSuccessMessage(intent),
      intent,
      dispatch,
    };
  }

  if (dispatch.handled) {
    return {
      ok: false,
      kind: "error",
      message: formatFailureMessage(intent, dispatch),
      intent,
      dispatch,
    };
  }

  return {
    ok: false,
    kind: intent.intent === "unknown" ? "clarification" : "error",
    message:
      intent.intent === "unknown"
        ? formatClarificationMessage(intent)
        : formatFailureMessage(intent, dispatch),
    intent,
    dispatch,
  };
}

function canSpeak(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export interface CinderReflexEngine {
  kind: "CRE";
  bind(handler: CinderReflexHandler): void;
  unbind(handler: CinderReflexHandler): void;
  format(intent: CinderResolvedIntent, dispatch?: CinderDispatchResult): CinderReflexResult;
  respond(
    intent: CinderResolvedIntent,
    dispatch?: CinderDispatchResult,
    options?: CinderReflexOptions,
  ): Promise<CinderReflexResult>;
  say(text: string): boolean;
}

export function createReflexEngine(): CinderReflexEngine {
  const handlers = new Set<CinderReflexHandler>();

  return {
    kind: "CRE",

    bind(handler) {
      handlers.add(handler);
    },

    unbind(handler) {
      handlers.delete(handler);
    },

    format(intent, dispatch) {
      return {
        ...buildReflexResult(intent, dispatch),
        spoken: false,
      };
    },

    async respond(intent, dispatch, options) {
      const shouldSpeak = options?.speak === true;
      let spoken = false;

      const base = buildReflexResult(intent, dispatch);

      if (shouldSpeak) {
        spoken = this.say(base.message);
      }

      const result: CinderReflexResult = {
        ...base,
        spoken,
      };

      for (const handler of handlers) {
        try {
          await handler(result);
        } catch {
          continue;
        }
      }

      return result;
    },

    say(text) {
      if (!canSpeak()) {
        return false;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
      return true;
    },
  };
}
