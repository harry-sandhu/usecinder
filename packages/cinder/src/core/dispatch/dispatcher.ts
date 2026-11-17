import type {
  CinderBindingHandler,
  CinderBindingType,
  CinderDispatchContext,
  CinderDispatchResult,
  CinderDomAdapter,
  CinderDomAdapterContext,
  CinderGraphNode,
  CinderGraphSnapshot,
  CinderResolvedIntent,
  CinderResolutionStep,
  CinderRouteDefinition,
} from "../../types.js";
import { getDependenciesOf } from "../cag/graphBuilder.js";
import { resolveElementsFromNode, resolveFirstElementFromNode } from "../dom/nodeSources.js";
import {
  canClickElement,
  canFocusElement,
  canScrollIntoView,
  dispatchDomEvent,
  escapeCssIdentifier,
  getDefaultView,
  getInputLikeName,
  isAnchorElement,
  isContentEditableElement,
  isFormElement,
  isHtmlElement,
  isInputElement,
  isSelectElement,
  isTextAreaElement,
} from "../dom/realm.js";
import { normalizeSemanticKey } from "../semantic/normalize.js";

type BindingRegistry = Map<string, CinderBindingHandler>;
type RouteRegistry = Map<string, CinderRouteDefinition>;
type DomAdapterRegistry = Map<string, CinderDomAdapter>;

function makeBindingKey(type: CinderBindingType, key: string): string {
  return `${type}:${key}`;
}

function makeRouteRegistryKey(key: string): string {
  return normalizeSemanticKey(key);
}

function getQueryRoot(root?: ParentNode | Document): ParentNode | Document | null {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function resolveNodeForStep(
  snapshot: CinderGraphSnapshot,
  step: CinderResolutionStep,
  intent: CinderResolvedIntent,
): CinderGraphNode | undefined {
  const matchedNodes = (intent.matchedNodeIds ?? [])
    .map((id) => snapshot.nodes.find((node) => node.id === id))
    .filter((node): node is CinderGraphNode => Boolean(node));

  const primaryType: CinderGraphNode["type"] | undefined =
    step.type === "navigate"
      ? "route"
      : step.type === "trigger_action" || step.type === "search"
        ? "action"
        : step.type === "set_field"
          ? "field"
          : step.type === "set_filter"
            ? "filter"
            : step.type === "show_output"
              ? "output"
              : undefined;

  const byMatched = matchedNodes.find((node) => {
    return (!primaryType || node.type === primaryType) && (!step.target || node.key === step.target);
  });

  if (byMatched) {
    return byMatched;
  }

  return snapshot.nodes.find((node) => {
    return (!primaryType || node.type === primaryType) && (!step.target || node.key === step.target);
  });
}

function resolveElementFromNode(
  node: CinderGraphNode | undefined,
  root?: ParentNode | Document,
): Element | null {
  return resolveFirstElementFromNode(node, root);
}

function resolveElementBySelector(
  selector: string | undefined,
  root?: ParentNode | Document,
): Element | null {
  if (!selector) {
    return null;
  }

  const target = getQueryRoot(root);
  if (!target || typeof (target as ParentNode).querySelector !== "function") {
    return null;
  }

  try {
    return target.querySelector(selector);
  } catch {
    return null;
  }
}

function clickElement(element: Element): boolean {
  if (canClickElement(element)) {
    element.click();
    return true;
  }

  return false;
}

function getNodeMetadataString(node: CinderGraphNode | undefined, key: string): string | undefined {
  const value = node?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNodeMetadataBoolean(node: CinderGraphNode | undefined, key: string): boolean | undefined {
  const value = node?.metadata?.[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.trim().toLowerCase())) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(value.trim().toLowerCase())) {
      return false;
    }
  }

  return undefined;
}

function resolveRouteDefinition(
  routes: RouteRegistry,
  step: CinderResolutionStep,
): CinderRouteDefinition | undefined {
  if (!step.target) {
    return undefined;
  }

  return routes.get(makeRouteRegistryKey(step.target));
}

function resolveRoutePath(
  routeDefinition: CinderRouteDefinition | undefined,
  node: CinderGraphNode | undefined,
): string | undefined {
  return routeDefinition?.path ?? getNodeMetadataString(node, "routePath") ?? getNodeMetadataString(node, "href");
}

function resolveRouteSelector(
  routeDefinition: CinderRouteDefinition | undefined,
  node: CinderGraphNode | undefined,
): string | undefined {
  return routeDefinition?.selector ?? getNodeMetadataString(node, "routeSelector");
}

function navigateToPath(path: string, root?: ParentNode | Document): boolean {
  const targetWindow = getDefaultView(root);
  if (!targetWindow) {
    return false;
  }

  try {
    const url = new URL(path, targetWindow.location.href);

    if (url.origin !== targetWindow.location.origin) {
      targetWindow.location.assign(url.toString());
      return true;
    }

    const nextLocation = `${url.pathname}${url.search}${url.hash}`;

    if (
      url.hash &&
      url.pathname === targetWindow.location.pathname &&
      url.search === targetWindow.location.search
    ) {
      targetWindow.location.hash = url.hash;
      return true;
    }

    targetWindow.history.pushState({}, "", nextLocation);
    const EventCtor = targetWindow.Event ?? Event;
    targetWindow.dispatchEvent(new EventCtor("popstate"));
    return true;
  } catch {
    try {
      targetWindow.location.assign(path);
      return true;
    } catch {
      return false;
    }
  }
}

function updateRuntimeFromStep(
  snapshot: CinderGraphSnapshot,
  step: CinderResolutionStep,
  node?: CinderGraphNode,
): void {
  switch (step.type) {
    case "navigate": {
      if (node) {
        snapshot.runtime.activeRouteId = node.id;

        const firstContext = snapshot.nodes.find((candidate) => {
          return candidate.type === "context" && candidate.routeId === node.id;
        });

        snapshot.runtime.activeContextId = firstContext?.id;
      }
      break;
    }

    case "set_field":
    case "set_filter": {
      snapshot.runtime.selections = {
        ...(snapshot.runtime.selections ?? {}),
        [step.target ?? "unknown"]: step.value,
      };

      if (node?.contextId) {
        snapshot.runtime.activeContextId = node.contextId;
      }
      break;
    }

    case "trigger_action":
    case "search": {
      if (node) {
        snapshot.runtime.focusedNodeId = node.id;
        if (node.contextId) {
          snapshot.runtime.activeContextId = node.contextId;
        }
      }
      break;
    }

    case "show_output": {
      if (node) {
        snapshot.runtime.focusedNodeId = node.id;
        if (node.contextId) {
          snapshot.runtime.activeContextId = node.contextId;
        }
      }
      break;
    }
  }
}

function getNativeSetter<T extends object>(target: T, property: "value" | "checked") {
  let prototype: object | null = Object.getPrototypeOf(target);

  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor?.set) {
      return descriptor.set;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return undefined;
}

function setNativePropertyValue(target: object, property: "value" | "checked", value: unknown): boolean {
  const setter = getNativeSetter(target, property);

  if (setter) {
    setter.call(target, value);
    return true;
  }

  if (property in (target as Record<string, unknown>)) {
    (target as Record<string, unknown>)[property] = value;
    return true;
  }

  return false;
}

function normalizeBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on", "checked", "enable", "enabled"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", "unchecked", "disable", "disabled"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function getClosestForm(element: Element | null): HTMLFormElement | null {
  if (!element || typeof element.closest !== "function") {
    return null;
  }

  const closest = element.closest("form");
  return isFormElement(closest) ? closest : null;
}

function submitForm(form: HTMLFormElement): boolean {
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return true;
  }

  dispatchDomEvent(form, "submit");
  return true;
}

function executeActionElement(element: Element, node?: CinderGraphNode): boolean {
  if (isFormElement(element)) {
    return submitForm(element);
  }

  if (getNodeMetadataBoolean(node, "submit") === true) {
    const form = getClosestForm(element);
    if (form) {
      return submitForm(form);
    }
  }

  if (isAnchorElement(element)) {
    return clickElement(element);
  }

  if (isInputElement(element)) {
    if (["submit", "button", "reset", "checkbox", "radio"].includes(element.type)) {
      return clickElement(element);
    }
  }

  const role = getNodeMetadataString(node, "role") ?? element.getAttribute("role") ?? undefined;
  if (role && ["button", "link", "menuitem", "tab"].includes(role)) {
    return clickElement(element);
  }

  const form = getClosestForm(element);
  if (form && (getNodeMetadataBoolean(node, "submit") === true || element.getAttribute("type") === "submit")) {
    return submitForm(form);
  }

  return clickElement(element);
}

function matchOptionValue(select: HTMLSelectElement, rawValue: string): string | undefined {
  const normalizedValue = rawValue.trim().toLowerCase();

  for (const option of Array.from(select.options)) {
    if (option.value.trim().toLowerCase() === normalizedValue) {
      return option.value;
    }

    if (option.text.trim().toLowerCase() === normalizedValue) {
      return option.value;
    }
  }

  return undefined;
}

function setCheckboxValue(input: HTMLInputElement, value: unknown): boolean {
  const normalizedBoolean = normalizeBooleanLike(value);
  const checked = normalizedBoolean ?? true;

  setNativePropertyValue(input, "checked", checked);
  dispatchDomEvent(input, "input");
  dispatchDomEvent(input, "change");
  return true;
}

function setRadioValue(input: HTMLInputElement, value: unknown, root?: ParentNode | Document): boolean {
  const normalizedBoolean = normalizeBooleanLike(value);

  if (normalizedBoolean === true || value === undefined || value === null || String(value).trim() === "") {
    setNativePropertyValue(input, "checked", true);
    dispatchDomEvent(input, "input");
    dispatchDomEvent(input, "change");
    return true;
  }

  if (normalizedBoolean === false) {
    setNativePropertyValue(input, "checked", false);
    dispatchDomEvent(input, "input");
    dispatchDomEvent(input, "change");
    return true;
  }

  const stringValue = String(value).trim().toLowerCase();

  if (input.value.trim().toLowerCase() === stringValue) {
    setNativePropertyValue(input, "checked", true);
    dispatchDomEvent(input, "input");
    dispatchDomEvent(input, "change");
    return true;
  }

  const inputName = getInputLikeName(input);
  if (!inputName) {
    return false;
  }

  const target = getQueryRoot(root);
  if (!target || typeof (target as ParentNode).querySelectorAll !== "function") {
    return false;
  }

  const radios = Array.from((target as ParentNode).querySelectorAll(`input[type="radio"][name="${escapeCssIdentifier(inputName, target)}"]`));
  const matchedRadio = radios.find((radio) => isInputElement(radio) && radio.value.trim().toLowerCase() === stringValue) ?? null;

  if (!isInputElement(matchedRadio)) {
    return false;
  }

  setNativePropertyValue(matchedRadio, "checked", true);
  dispatchDomEvent(matchedRadio, "input");
  dispatchDomEvent(matchedRadio, "change");
  return true;
}

function setContentEditableValue(element: HTMLElement, value: unknown): boolean {
  element.textContent = typeof value === "string" ? value : String(value ?? "");
  dispatchDomEvent(element, "input");
  dispatchDomEvent(element, "change");
  return true;
}

function setElementValue(element: Element, value: unknown, root?: ParentNode | Document): boolean {
  const stringValue = typeof value === "string" ? value : String(value ?? "");

  if (isInputElement(element)) {
    if (element.type === "checkbox") {
      return setCheckboxValue(element, value);
    }

    if (element.type === "radio") {
      return setRadioValue(element, value, root);
    }

    setNativePropertyValue(element, "value", stringValue);
    dispatchDomEvent(element, "input");
    dispatchDomEvent(element, "change");
    return true;
  }

  if (isTextAreaElement(element)) {
    setNativePropertyValue(element, "value", stringValue);
    dispatchDomEvent(element, "input");
    dispatchDomEvent(element, "change");
    return true;
  }

  if (isSelectElement(element)) {
    const matchedValue = matchOptionValue(element, stringValue) ?? stringValue;
    setNativePropertyValue(element, "value", matchedValue);
    dispatchDomEvent(element, "input");
    dispatchDomEvent(element, "change");
    return true;
  }

  if (isContentEditableElement(element) && element.isContentEditable) {
    return setContentEditableValue(element, value);
  }

  const dynamicElement = element as Element & { value?: unknown };

  if ("value" in dynamicElement) {
    setNativePropertyValue(dynamicElement as object, "value", stringValue);
    dispatchDomEvent(element, "input");
    dispatchDomEvent(element, "change");
    return true;
  }

  return false;
}

function revealElement(element: Element): boolean {
  if (!isHtmlElement(element)) {
    return false;
  }

  if (canScrollIntoView(element)) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (canFocusElement(element)) {
    element.focus();
  }

  return canScrollIntoView(element) || canFocusElement(element);
}

function getBindingTypeForStep(step: CinderResolutionStep): CinderBindingType | undefined {
  switch (step.type) {
    case "navigate":
      return "route";
    case "trigger_action":
    case "search":
      return "action";
    case "set_field":
      return "field";
    case "set_filter":
      return "filter";
    case "show_output":
      return "output";
    default:
      return undefined;
  }
}

function createDomAdapterContext(
  intent: CinderResolvedIntent,
  step: CinderResolutionStep,
  snapshot: CinderGraphSnapshot,
  node: CinderGraphNode | undefined,
  element: Element,
  root?: ParentNode | Document,
): CinderDomAdapterContext {
  return {
    intent,
    step,
    snapshot,
    node,
    element,
    root,
  };
}

async function tryDomAdapters(
  adapters: DomAdapterRegistry,
  intent: CinderResolvedIntent,
  step: CinderResolutionStep,
  snapshot: CinderGraphSnapshot,
  node: CinderGraphNode | undefined,
  element: Element,
  root?: ParentNode | Document,
): Promise<{ handled: boolean; error?: string }> {
  const context = createDomAdapterContext(intent, step, snapshot, node, element, root);

  for (const adapter of adapters.values()) {
    try {
      if (!adapter.match(context)) {
        continue;
      }
    } catch (error) {
      return {
        handled: false,
        error: error instanceof Error ? error.message : `DOM adapter match failed for step ${step.type}.`,
      };
    }

    try {
      const handled = await adapter.execute(context);
      if (handled) {
        return { handled: true };
      }
    } catch (error) {
      return {
        handled: false,
        error: error instanceof Error ? error.message : `DOM adapter execution failed for step ${step.type}.`,
      };
    }
  }

  return { handled: false };
}

async function tryRegisteredRouteNavigation(
  routes: RouteRegistry,
  snapshot: CinderGraphSnapshot,
  step: CinderResolutionStep,
  node: CinderGraphNode | undefined,
): Promise<{ handled: boolean; mode: "binding" | "dom" | "none"; error?: string }> {
  const routeDefinition = resolveRouteDefinition(routes, step);

  if (!routeDefinition?.navigate) {
    return { handled: false, mode: "none" };
  }

  try {
    await routeDefinition.navigate();
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "binding" };
  } catch (error) {
    return {
      handled: false,
      mode: "none",
      error: error instanceof Error ? error.message : `Registered route navigation failed for ${step.target ?? "unknown"}.`,
    };
  }
}

function tryRouteDomNavigation(
  routes: RouteRegistry,
  snapshot: CinderGraphSnapshot,
  step: CinderResolutionStep,
  node: CinderGraphNode | undefined,
  root?: ParentNode | Document,
): { handled: boolean; mode: "binding" | "dom" | "none"; error?: string } {
  const routeDefinition = resolveRouteDefinition(routes, step);
  const routeElements = resolveElementsFromNode(node, root);
  const visibleAnchorElement = routeElements.find((element) => isHtmlElement(element) && element.offsetParent !== null && isAnchorElement(element))
    ?? routeElements.find((element) => isAnchorElement(element))
    ?? null;
  const element = visibleAnchorElement ?? routeElements[0] ?? null;
  const path = resolveRoutePath(routeDefinition, node);
  const selector = resolveRouteSelector(routeDefinition, node);
  const selectorElement = resolveElementBySelector(selector, root);

  // "harvestedReference" means this route was ALSO (or only) discovered via static
  // reference harvesting (e.g. crawling an <a href> inside another page's content) rather
  // than being authored as its own cinder-route. For a harvested reference, the "live
  // element" resolveElementsFromNode finds is typically the very harvested link itself -
  // clicking it isn't a deliberate "enter this route" trigger, it's just the link the
  // reference was inferred from, and relying on a raw .click() to navigate is unreliable
  // (e.g. in jsdom, or any environment without real browser navigation) - path navigation
  // is the correct, deterministic choice there.
  //
  // An EXPLICIT data-cinder-route-selector, by contrast, is the app author deliberately
  // declaring "click this element to enter this route" - that's real author intent (it may
  // be an SPA router Link with its own click handler that a bare location change would
  // bypass), so it should win even when the route is also harvestedReference. Only an
  // explicit selector match overrides the path preference - not an incidentally-resolved
  // visibleAnchorElement, which for a harvested route is usually the harvested link itself.
  // (Found via two real test failures that pulled in opposite directions: a route with an
  // explicit selector AND harvestedReference=true needs the selector click to win [the
  // selector's listener never fired otherwise]; a purely harvested doc-link route needs the
  // path preference to win [clicking the harvested link alone doesn't navigate in jsdom].)
  const hasExplicitSelectorAnchor = isAnchorElement(selectorElement);
  const shouldPreferPathNavigation = !hasExplicitSelectorAnchor && getNodeMetadataBoolean(node, "harvestedReference") === true;

  if (shouldPreferPathNavigation && path && navigateToPath(path, root)) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  if (isAnchorElement(visibleAnchorElement) && clickElement(visibleAnchorElement)) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  if (isAnchorElement(selectorElement) && clickElement(selectorElement)) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  if (path && navigateToPath(path, root)) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  if (selectorElement && clickElement(selectorElement)) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  if (element && clickElement(element)) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  return {
    handled: false,
    mode: "none",
    error: `No registered route navigation, path, selector, or clickable DOM element was found for route ${step.target ?? "unknown"}.`,
  };
}

/**
 * Warns - never blocks - when a composite command's steps execute out of a
 * declared data-cinder-depends-on order (e.g. an action that depends on a
 * filter being set, but the filter's step comes after the action's step in
 * this particular command). This is deliberately a warning surfaced through
 * dispatch.errors, not an auto-reorder of the steps: silently changing the
 * order a user actually asked for risks changing what they meant, whereas
 * surfacing the problem lets a caller (or a future AI fallback) decide. Only
 * meaningful for composite commands (2+ steps); a single-step command has
 * nothing to be out of order relative to.
 */
function checkDependencyOrder(
  snapshot: CinderGraphSnapshot,
  intent: CinderResolvedIntent,
  steps: CinderResolutionStep[],
): string[] {
  if (steps.length <= 1) {
    return [];
  }

  const stepNodeIds = steps.map((step) => resolveNodeForStep(snapshot, step, intent)?.id);
  const warnings: string[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const nodeId = stepNodeIds[index];

    if (!nodeId) {
      continue;
    }

    for (const dependency of getDependenciesOf(snapshot, nodeId)) {
      const dependencyIndex = stepNodeIds.indexOf(dependency.id);

      if (dependencyIndex === -1 || dependencyIndex < index) {
        continue;
      }

      warnings.push(
        `Step "${steps[index]!.type}"${steps[index]!.target ? ` (${steps[index]!.target})` : ""} declares a dependency on "${dependency.key}", but it appears later in this composite command (position ${dependencyIndex + 1} vs ${index + 1}).`,
      );
    }
  }

  return warnings;
}

async function executeStep(
  bindings: BindingRegistry,
  routes: RouteRegistry,
  adapters: DomAdapterRegistry,
  snapshot: CinderGraphSnapshot,
  intent: CinderResolvedIntent,
  step: CinderResolutionStep,
  root?: ParentNode | Document,
): Promise<{ handled: boolean; mode: "binding" | "dom" | "none"; error?: string }> {
  const bindingType = getBindingTypeForStep(step);
  const node = resolveNodeForStep(snapshot, step, intent);
  let priorError: string | undefined;

  if (step.type === "navigate") {
    const routeNavigation = await tryRegisteredRouteNavigation(routes, snapshot, step, node);
    if (routeNavigation.handled) {
      return routeNavigation;
    }

    priorError = routeNavigation.error;
  }

  if (bindingType && step.target) {
    const handler = bindings.get(makeBindingKey(bindingType, step.target));

    if (handler) {
      const context: CinderDispatchContext = {
        intent,
        step,
        snapshot,
        node,
        root,
      };

      try {
        await handler(context);
        updateRuntimeFromStep(snapshot, step, node);
        return { handled: true, mode: "binding" };
      } catch (error) {
        return {
          handled: false,
          mode: "none",
          error: error instanceof Error ? error.message : `Bound handler failed for step ${step.type}.`,
        };
      }
    }
  }

  if (step.type === "navigate") {
    const domNavigation = tryRouteDomNavigation(routes, snapshot, step, node, root);

    if (!domNavigation.handled && priorError && !domNavigation.error) {
      return {
        ...domNavigation,
        error: priorError,
      };
    }

    if (!domNavigation.handled && priorError && domNavigation.error) {
      return {
        ...domNavigation,
        error: `${priorError} ${domNavigation.error}`,
      };
    }

    return domNavigation;
  }

  const element = resolveElementFromNode(node, root);

  if (!element) {
    return {
      handled: false,
      mode: "none",
      error: priorError ?? `No bound handler or DOM element found for step ${step.type}${step.target ? ` (${step.target})` : ""}.`,
    };
  }

  const adapterResult = await tryDomAdapters(adapters, intent, step, snapshot, node, element, root);
  if (adapterResult.handled) {
    updateRuntimeFromStep(snapshot, step, node);
    return { handled: true, mode: "dom" };
  }

  if (adapterResult.error) {
    return {
      handled: false,
      mode: "none",
      error: adapterResult.error,
    };
  }

  let success = false;

  switch (step.type) {
    case "trigger_action":
    case "search":
      success = executeActionElement(element, node);
      break;
    case "set_field":
    case "set_filter":
      success = setElementValue(element, step.value, root);
      break;
    case "show_output":
      success = revealElement(element);
      break;
  }

  if (!success) {
    return {
      handled: false,
      mode: "none",
      error: `DOM fallback could not execute step ${step.type}${step.target ? ` (${step.target})` : ""}.`,
    };
  }

  updateRuntimeFromStep(snapshot, step, node);
  return { handled: true, mode: "dom" };
}

export interface CinderDispatcher {
  registerRoute(definition: CinderRouteDefinition): void;
  unregisterRoute(key: string): void;
  getRoutes(): CinderRouteDefinition[];
  registerDomAdapter(adapter: CinderDomAdapter): void;
  unregisterDomAdapter(id: string): void;
  getDomAdapters(): CinderDomAdapter[];
  bind(type: CinderBindingType, key: string, handler: CinderBindingHandler): void;
  unbind(type: CinderBindingType, key: string): void;
  dispatch(
    snapshot: CinderGraphSnapshot,
    intent: CinderResolvedIntent,
    root?: ParentNode | Document,
  ): Promise<CinderDispatchResult>;
}

export function createDispatcher(): CinderDispatcher {
  const bindings: BindingRegistry = new Map();
  const routes: RouteRegistry = new Map();
  const adapters: DomAdapterRegistry = new Map();

  return {
    registerRoute(definition) {
      routes.set(makeRouteRegistryKey(definition.key), {
        ...definition,
        key: makeRouteRegistryKey(definition.key),
      });
    },

    unregisterRoute(key) {
      routes.delete(makeRouteRegistryKey(key));
    },

    getRoutes() {
      return [...routes.values()];
    },

    registerDomAdapter(adapter) {
      adapters.set(adapter.id, adapter);
    },

    unregisterDomAdapter(id) {
      adapters.delete(id);
    },

    getDomAdapters() {
      return [...adapters.values()];
    },

    bind(type, key, handler) {
      bindings.set(makeBindingKey(type, key), handler);
    },

    unbind(type, key) {
      bindings.delete(makeBindingKey(type, key));
    },

    async dispatch(snapshot, intent, root) {
      const steps = intent.steps ?? [];

      if (intent.intent === "unknown" || steps.length === 0) {
        return {
          ok: false,
          handled: false,
          mode: "none",
          executedSteps: [],
          errors: intent.reason ? [intent.reason] : ["No executable steps were provided."],
        };
      }

      const executedSteps: CinderResolutionStep[] = [];
      const errors: string[] = [];
      const warnings = checkDependencyOrder(snapshot, intent, steps);
      let mode: CinderDispatchResult["mode"] = steps.length > 1 ? "composite" : "none";
      let handledAny = false;

      for (const step of steps) {
        const result = await executeStep(bindings, routes, adapters, snapshot, intent, step, root);

        if (result.handled) {
          executedSteps.push(step);
          handledAny = true;
          if (steps.length === 1) {
            mode = result.mode;
          }
        }

        if (result.error) {
          errors.push(result.error);
        }
      }

      return {
        ok: handledAny && errors.length === 0,
        handled: handledAny,
        mode,
        executedSteps,
        errors,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  };
}
