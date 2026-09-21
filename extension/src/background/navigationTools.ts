import { i18n } from "../shared/i18n.ts";

export const NAVIGATE_ACTIONS = [
  "back",
  "forward",
  "reload",
  "open_tab",
  "close_tab",
  "switch_tab",
  "go_to"
] as const;

export type NavigateAction = typeof NAVIGATE_ACTIONS[number];

export interface NavigateArgs {
  action: NavigateAction;
  ref?: string;
  url?: string;
}

export function parseNavigateArgs(argumentsJson: string): NavigateArgs {
  const value: unknown = JSON.parse(argumentsJson);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(i18n._({ id: "errors.navigateObject", message: "navigate arguments must be an object." }));
  }

  const args = value as Record<string, unknown>;
  const keys = Object.keys(args);
  if (keys.some((key) => key !== "action" && key !== "ref" && key !== "url")) {
    throw new Error(i18n._({ id: "errors.navigateUnsupportedArgument", message: "navigate contains an unsupported argument." }));
  }
  if (typeof args.action !== "string" || !isNavigateAction(args.action)) {
    throw new Error(i18n._({ id: "errors.navigateInvalidAction", message: "navigate action is invalid." }));
  }
  if (args.ref !== undefined && (typeof args.ref !== "string" || !/^tab_[0-9]+$/.test(args.ref))) {
    throw new Error(i18n._({ id: "errors.navigateInvalidRef", message: "navigate ref must be a tab ref from list(type=tab) or browser_context." }));
  }
  if (args.url !== undefined && (typeof args.url !== "string" || args.url.length === 0)) {
    throw new Error(i18n._({ id: "errors.navigateInvalidUrl", message: "navigate url must be a non-empty string." }));
  }

  const ref = args.ref as string | undefined;
  const url = args.url as string | undefined;
  if ((args.action === "open_tab" || args.action === "go_to") && url === undefined) {
    throw new Error(i18n._({ id: "errors.navigateUrlRequired", message: "{action} requires url.", values: { action: args.action } }));
  }
  if (args.action === "open_tab") {
    if (ref !== undefined) throw new Error(i18n._({ id: "errors.openTabRefForbidden", message: "ref cannot be specified for open_tab." }));
  } else if (ref === undefined) {
    throw new Error(i18n._({ id: "errors.navigateRefRequired", message: "{action} requires ref. Use the browser_context ref for the current tab.", values: { action: args.action } }));
  }
  if (args.action !== "open_tab" && args.action !== "go_to" && url !== undefined) {
    throw new Error(i18n._({ id: "errors.navigateUrlForbidden", message: "url cannot be specified for {action}.", values: { action: args.action } }));
  }

  return {
    action: args.action,
    ...(ref === undefined ? {} : { ref }),
    ...(url === undefined ? {} : { url })
  };
}

function isNavigateAction(value: string): value is NavigateAction {
  return (NAVIGATE_ACTIONS as readonly string[]).includes(value);
}
