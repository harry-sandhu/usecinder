// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import type {
  CinderRuntimeEventHandler,
  CinderRuntimeEventMap,
  CinderRuntimeEventName,
} from "../../types.js";

export interface CinderEventBus {
  on<EventName extends CinderRuntimeEventName>(
    event: EventName,
    handler: CinderRuntimeEventHandler<EventName>,
  ): void;
  off<EventName extends CinderRuntimeEventName>(
    event: EventName,
    handler: CinderRuntimeEventHandler<EventName>,
  ): void;
  emit<EventName extends CinderRuntimeEventName>(
    event: EventName,
    payload: CinderRuntimeEventMap[EventName],
  ): void;
}

export function createEventBus(): CinderEventBus {
  const handlers = new Map<CinderRuntimeEventName, Set<CinderRuntimeEventHandler<CinderRuntimeEventName>>>();

  return {
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? new Set<CinderRuntimeEventHandler<CinderRuntimeEventName>>();
      eventHandlers.add(handler as CinderRuntimeEventHandler<CinderRuntimeEventName>);
      handlers.set(event, eventHandlers);
    },

    off(event, handler) {
      handlers.get(event)?.delete(handler as CinderRuntimeEventHandler<CinderRuntimeEventName>);
    },

    emit(event, payload) {
      const eventHandlers = handlers.get(event);
      if (!eventHandlers) {
        return;
      }

      for (const handler of eventHandlers) {
        try {
          const result = handler(payload as never);
          if (result && typeof result === "object" && "catch" in result) {
            void (result as Promise<unknown>).catch(() => undefined);
          }
        } catch {
          continue;
        }
      }
    },
  };
}
