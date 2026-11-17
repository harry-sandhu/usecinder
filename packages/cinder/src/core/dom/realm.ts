// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
export function isDocumentNode(value: unknown): value is Document {
  return Boolean(value) && typeof value === "object" && (value as { nodeType?: unknown }).nodeType === 9;
}

export function isDomElement(value: unknown): value is Element {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { nodeType?: unknown }).nodeType === 1 &&
    typeof (value as { getAttribute?: unknown }).getAttribute === "function"
  );
}

export function getOwnerDocument(
  value?: ParentNode | Document | Element | null,
): Document | undefined {
  if (!value) {
    return typeof document !== "undefined" ? document : undefined;
  }

  if (isDocumentNode(value)) {
    return value;
  }

  const ownerDocument = (value as { ownerDocument?: Document | null }).ownerDocument;
  return ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
}

interface RealmWindowLike extends Window {
  Event?: typeof Event;
  CSS?: {
    escape?(value: string): string;
  };
}

export function getDefaultView(
  value?: ParentNode | Document | Element | null,
): RealmWindowLike | undefined {
  return (getOwnerDocument(value)?.defaultView as RealmWindowLike | undefined) ??
    (typeof window !== "undefined" ? (window as RealmWindowLike) : undefined);
}

export function getElementTagName(element: Element | null | undefined): string | undefined {
  if (!isDomElement(element) || typeof element.tagName !== "string") {
    return undefined;
  }

  return element.tagName.toLowerCase();
}

export function isHtmlElement(element: Element | null | undefined): element is HTMLElement {
  return isDomElement(element);
}

export function isAnchorElement(element: Element | null): element is HTMLAnchorElement {
  return getElementTagName(element) === "a";
}

export function isFormElement(element: Element | null): element is HTMLFormElement {
  return getElementTagName(element) === "form";
}

export function isInputElement(element: Element | null): element is HTMLInputElement {
  return getElementTagName(element) === "input";
}

export function isTextAreaElement(element: Element | null): element is HTMLTextAreaElement {
  return getElementTagName(element) === "textarea";
}

export function isSelectElement(element: Element | null): element is HTMLSelectElement {
  return getElementTagName(element) === "select";
}

export function canClickElement(
  element: Element | null | undefined,
): element is Element & { click(): void } {
  return isDomElement(element) && typeof (element as { click?: unknown }).click === "function";
}

export function canFocusElement(
  element: Element | null | undefined,
): element is Element & { focus(): void } {
  return isDomElement(element) && typeof (element as { focus?: unknown }).focus === "function";
}

export function canScrollIntoView(
  element: Element | null | undefined,
): element is Element & { scrollIntoView(options?: ScrollIntoViewOptions): void } {
  return isDomElement(element) && typeof (element as { scrollIntoView?: unknown }).scrollIntoView === "function";
}

export function isContentEditableElement(
  element: Element | null | undefined,
): element is HTMLElement & { isContentEditable: boolean } {
  return isDomElement(element) && "isContentEditable" in element;
}

export function getControlLabels(element: Element): ArrayLike<Element> | undefined {
  const labels = (element as Element & { labels?: ArrayLike<Element> | null }).labels;
  return labels ?? undefined;
}

export function getPlaceholderProperty(element: Element): string | undefined {
  const placeholder = (element as Element & { placeholder?: unknown }).placeholder;
  return typeof placeholder === "string" && placeholder.trim() ? placeholder.trim() : undefined;
}

export function getInputLikeType(element: Element | null | undefined): string | undefined {
  const value = (element as Element & { type?: unknown }).type;
  return typeof value === "string" ? value : undefined;
}

export function getInputLikeName(element: Element | null | undefined): string | undefined {
  const value = (element as Element & { name?: unknown }).name;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function escapeCssIdentifier(
  value: string,
  context?: ParentNode | Document | Element | null,
): string {
  const cssApi = getDefaultView(context)?.CSS ?? (typeof CSS !== "undefined" ? CSS : undefined);

  if (typeof cssApi?.escape === "function") {
    return cssApi.escape(value);
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function dispatchDomEvent(
  element: Element,
  type: string,
  init: EventInit = { bubbles: true },
): void {
  const EventCtor = getDefaultView(element)?.Event ?? (typeof Event !== "undefined" ? Event : undefined);

  if (EventCtor) {
    element.dispatchEvent(new EventCtor(type, init));
    return;
  }

  const ownerDocument = getOwnerDocument(element);
  if (ownerDocument && typeof ownerDocument.createEvent === "function") {
    const event = ownerDocument.createEvent("Event");
    event.initEvent(type, Boolean(init.bubbles), Boolean(init.cancelable));
    element.dispatchEvent(event);
  }
}
