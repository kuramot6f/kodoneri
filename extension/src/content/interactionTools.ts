export interface InteractArgs {
  action: "click" | "type" | "press" | "select" | "check";
  query: string;
  value?: string;
}

/** Arguments were validated by the background; errors are thrown for the tool reply. */
export function interact(args: InteractArgs) {
  const element = document.querySelector(args.query);
  if (!element) throw new Error(`No element matches query: ${args.query}`);
  runInteraction(element, args);
  return { action: args.action, query: args.query, element: element.localName, success: true };
}

function runInteraction(element: Element, args: InteractArgs): void {
  if (args.action === "click") {
    if (!(element instanceof HTMLElement)) throw new Error("This element cannot be clicked.");
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
  throw new Error("type can only be used with input, textarea, or contenteditable elements.");
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
  if (!setter) throw new Error("Could not set the input value.");
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
  if (!accepted) throw new Error("type was cancelled by a beforeinput event.");
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
  if (!(element instanceof HTMLElement)) throw new Error("Keyboard input cannot be sent to this element.");
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
    throw new Error("select can only be used with select elements.");
  }
  if (![...element.options].some((option) => option.value === value)) {
    throw new Error(`No option matches value: ${value}`);
  }
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function checkElement(element: Element): void {
  if (!(element instanceof HTMLInputElement)
    || (element.type !== "checkbox" && element.type !== "radio")) {
    throw new Error("check can only be used with checkbox or radio elements.");
  }
  if (!element.checked) element.click();
}
