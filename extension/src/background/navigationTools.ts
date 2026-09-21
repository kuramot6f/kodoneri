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
    throw new Error("navigateの引数はオブジェクトで指定してください。");
  }

  const args = value as Record<string, unknown>;
  const keys = Object.keys(args);
  if (keys.some((key) => key !== "action" && key !== "ref" && key !== "url")) {
    throw new Error("navigateに未対応の引数が含まれています。");
  }
  if (typeof args.action !== "string" || !isNavigateAction(args.action)) {
    throw new Error("navigateのactionが不正です。");
  }
  if (args.ref !== undefined && (typeof args.ref !== "string" || !/^tab_[0-9]+$/.test(args.ref))) {
    throw new Error("navigateのrefにはlist(type=tab)かbrowser_contextのタブ参照を指定してください。");
  }
  if (args.url !== undefined && (typeof args.url !== "string" || args.url.length === 0)) {
    throw new Error("navigateのurlには空でない文字列を指定してください。");
  }

  const ref = args.ref as string | undefined;
  const url = args.url as string | undefined;
  if ((args.action === "open_tab" || args.action === "go_to") && url === undefined) {
    throw new Error(`${args.action}にはurlが必要です。`);
  }
  if (args.action === "open_tab") {
    if (ref !== undefined) throw new Error("open_tabにはrefを指定できません。");
  } else if (ref === undefined) {
    throw new Error(`${args.action}にはrefが必要です。現在のタブはbrowser_contextのrefを使います。`);
  }
  if (args.action !== "open_tab" && args.action !== "go_to" && url !== undefined) {
    throw new Error(`${args.action}にはurlを指定できません。`);
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
