import type { ToolOutput } from "../shared/protocol";
import { i18n } from "../shared/i18n.ts";

type InteractionAction = "click" | "type" | "press" | "select" | "check";

interface InteractionArgs {
  action: InteractionAction;
  query: string;
  value?: string;
}

export function interactWithPage(argumentsJson: string): ToolOutput {
  try {
    const args = parseInteractionArgs(JSON.parse(argumentsJson));
    const element = document.querySelector(args.query);
    if (!element) throw new Error(i18n._({ id: "errors.elementNotFound", message: "No element matches query: {query}", values: { query: args.query } }));

    runInteraction(element, args);
    return {
      type: "text",
      content: JSON.stringify({
        action: args.action,
        query: args.query,
        element: element.localName,
        success: true
      })
    };
  } catch (error) {
    return {
      type: "error",
      error: error instanceof Error && error.message
        ? error.message
        : i18n._({ id: "errors.interactionFailed", message: "Could not interact with the page." })
    };
  }
}

function parseInteractionArgs(value: unknown): InteractionArgs {
  if (!value || typeof value !== "object") throw new Error(i18n._({ id: "errors.invalidArguments", message: "Invalid arguments." }));
  const { action, query, value: input, ref } = value as Record<string, unknown>;
  if (!isInteractionAction(action)) throw new Error(i18n._({ id: "errors.invalidAction", message: "Invalid action." }));
  if (typeof query !== "string" || !query.trim() || query.length > 10000) {
    throw new Error(i18n._({ id: "errors.invalidQuery", message: "query must be a CSS selector between 1 and 10000 characters." }));
  }
  // Background strips a tab or iframe ref before delivery, so a remaining ref names a resource instead.
  if (ref !== undefined) throw new Error(i18n._({ id: "errors.invalidInteractionRef", message: "interact ref must identify a tab or iframe." }));
  if (action === "type" || action === "press" || action === "select") {
    if (typeof input !== "string") throw new Error(i18n._({ id: "errors.actionValueRequired", message: "{action} requires value.", values: { action } }));
  } else if (input !== undefined) {
    throw new Error(i18n._({ id: "errors.actionValueForbidden", message: "value cannot be specified for {action}.", values: { action } }));
  }
  return { action, query, value: input as string | undefined };
}

function isInteractionAction(value: unknown): value is InteractionAction {
  return value === "click" || value === "type" || value === "press"
    || value === "select" || value === "check";
}

function runInteraction(element: Element, args: InteractionArgs): void {
  if (args.action === "click") {
    if (!(element instanceof HTMLElement)) throw new Error(i18n._({ id: "errors.notClickable", message: "This element cannot be clicked." }));
    element.click();
    return;
  }
  if (args.action === "type") {
    setTextValue(element, args.value ?? "");
    return;
  }
  if (args.action === "press") {
    pressKey(element, args.value ?? "");
    return;
  }
  if (args.action === "select") {
    selectValue(element, args.value ?? "");
    return;
  }
  checkElement(element);
}

function setTextValue(element: Element, value: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setFormControlValue(element, value);
    return;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    setContentEditableValue(element, value);
    return;
  }
  throw new Error(i18n._({ id: "errors.notTypeable", message: "type can only be used with input, textarea, or contenteditable elements." }));
}

function setFormControlValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  element.focus();
  dispatchBeforeInput(element, value);
  const prototype = element instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error(i18n._({ id: "errors.setInputValue", message: "Could not set the input value." }));
  setter.call(element, value);
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    composed: true,
    data: value,
    inputType: "insertReplacementText"
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setContentEditableValue(element: HTMLElement, value: string): void {
  element.focus();
  dispatchBeforeInput(element, value);
  element.replaceChildren(element.ownerDocument.createTextNode(value));
  moveCaretToEnd(element);
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    composed: true,
    data: value,
    inputType: "insertReplacementText"
  }));
}

function dispatchBeforeInput(element: HTMLElement, value: string): void {
  const accepted = element.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    composed: true,
    cancelable: true,
    data: value,
    inputType: "insertReplacementText"
  }));
  if (!accepted) throw new Error(i18n._({ id: "errors.beforeInputCancelled", message: "type was cancelled by a beforeinput event." }));
}

function moveCaretToEnd(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function pressKey(element: Element, key: string): void {
  if (!(element instanceof HTMLElement)) throw new Error(i18n._({ id: "errors.notKeyable", message: "Keyboard input cannot be sent to this element." }));
  element.focus();
  for (const type of ["keydown", "keyup"] as const) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      composed: true,
      cancelable: true
    }));
  }
}

function selectValue(element: Element, value: string): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(i18n._({ id: "errors.notSelectable", message: "select can only be used with select elements." }));
  }
  if (![...element.options].some((option) => option.value === value)) {
    throw new Error(i18n._({ id: "errors.optionNotFound", message: "No option matches value: {value}", values: { value } }));
  }
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function checkElement(element: Element): void {
  if (!(element instanceof HTMLInputElement)
    || (element.type !== "checkbox" && element.type !== "radio")) {
    throw new Error(i18n._({ id: "errors.notCheckable", message: "check can only be used with checkbox or radio elements." }));
  }
  if (!element.checked) element.click();
}
