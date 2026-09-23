import { createAnthropic } from "@ai-sdk/anthropic";
import { i18n } from "../shared/i18n.ts";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { DeepSeekFilesOptions, DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { OpenAIFilesOptions, OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import type { LanguageModel, streamText, uploadFile } from "ai";
import { CATALOG, PLANS, clampEffort, findModel, isPlan, lowestEffort, modelKey } from "../shared/models";
import type { Effort, ModelInfo, ModelSettings, Plan, Provider } from "../shared/models";
import { TOOL_HISTORY_TTL_MS } from "../shared/conversation";

/** The chatext gateway relays each provider's own API under `/{provider}`; the key is the gateway token. */
const GATEWAY_URL = "https://<gateway-host>";
/** Where each SDK's default base URL sits on the gateway. */
const GATEWAY_BASE: Record<Provider, string> = {
  openai: `${GATEWAY_URL}/openai`,
  anthropic: `${GATEWAY_URL}/anthropic/v1`,
  deepseek: `${GATEWAY_URL}/deepseek`
};

const MEMORY_MODEL_ID = "gpt-6-luna";

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;
type FilesApi = Parameters<typeof uploadFile>[0]["api"];

/** Everything one request needs; built per request from the settings and the in-memory keys. */
export interface ModelRuntime {
  info: ModelInfo;
  model: LanguageModel;
  files: FilesApi;
  providerOptions: ProviderOptions;
  fileOptions: ProviderOptions;
}

/** Provider keys, plus the gateway token under "chatext". */
export type ApiKeys = Partial<Record<Provider | "chatext", string>>;

let apiKeys: ApiKeys = {};
let plan: Plan | null = null;

/** Asks the native app for the Keychain keys and the gateway for the plan. Called on worker start, when the model menu opens and when a new conversation begins. */
export async function refreshApiKeys(): Promise<void> {
  const response = await browser.runtime.sendNativeMessage("application.id", { type: "apiKeys" }) as ApiKeys;
  apiKeys = Object.fromEntries(Object.entries(response).filter(([, key]) => typeof key === "string" && key));
  // A failed lookup keeps the last known plan so a flaky network does not hide the subscription models.
  plan = apiKeys.chatext ? await fetchPlan(apiKeys.chatext).catch(() => plan) : null;
}

/** Without any key or gateway token nothing can be sent, so a new chat points to the app instead. */
export function hasCredentials(): boolean {
  return Object.keys(apiKeys).length > 0;
}

async function fetchPlan(token: string): Promise<Plan | null> {
  const response = await fetch(`${GATEWAY_URL}/usage`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`usage returned ${response.status}`);
  const { plan } = await response.json() as { plan?: unknown };
  return isPlan(plan) ? plan : null;
}

/** Subscription models first, then every model whose provider has a key. */
export function availableModels(): ModelInfo[] {
  const subscribed = plan ? CATALOG.filter((model) => PLANS[plan!].includes(model.id)).map((model) => findModel(modelKey("chatext", model.id))!) : [];
  const own = CATALOG.filter((model) => apiKeys[model.provider]).map((model) => findModel(modelKey("byok", model.id))!);
  return [...subscribed, ...own];
}

/** The first candidate whose model is available wins; without one, the first available model takes the first candidate's effort. */
export function resolveSettings(...candidates: (ModelSettings | undefined)[]): ModelSettings | null {
  const models = availableModels();
  const settings = candidates.filter((candidate) => candidate !== undefined);
  for (const candidate of settings) {
    const info = models.find((model) => model.key === candidate.model);
    if (info) return { model: info.key, effort: clampEffort(info, candidate.effort) };
  }
  const info = models[0];
  return info ? { model: info.key, effort: clampEffort(info, settings[0]?.effort ?? "medium") } : null;
}

/** Memory maintenance runs on GPT-6 Luna reached the same way as the chosen model; without it, on the chosen model's lowest effort. */
export function createMemoryRuntime(settings: ModelSettings): ModelRuntime {
  const key = modelKey(findModel(settings.model)?.access ?? "byok", MEMORY_MODEL_ID);
  return availableModels().some((model) => model.key === key)
    ? createRuntime({ model: key, effort: "low" }, "low")
    : createRuntime(settings, "lowest");
}

export function createRuntime(settings: ModelSettings, effort: Effort | "lowest"): ModelRuntime {
  const info = findModel(settings.model);
  const apiKey = info && apiKeys[info.access === "chatext" ? "chatext" : info.provider];
  if (!info || !apiKey) throw new Error(i18n._({ id: "errors.apiKeyMissing", message: "No API key is configured. Configure one in the chatext app." }));
  const baseURL = info.access === "chatext" ? GATEWAY_BASE[info.provider] : undefined;
  const level = effort === "lowest" ? lowestEffort(info) : clampEffort(info, effort);
  const expiresAfter = TOOL_HISTORY_TTL_MS / 1000;

  switch (info.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey, baseURL });
      return {
        info,
        model: openai(info.id),
        files: openai.files(),
        providerOptions: {
          openai: { reasoningEffort: level } satisfies OpenAILanguageModelResponsesOptions
        },
        fileOptions: { openai: { purpose: "user_data", expiresAfter } satisfies OpenAIFilesOptions }
      };
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey,
        baseURL,
        headers: {
          "anthropic-dangerous-direct-browser-access": "true",
          // Opts into drop_block: a thinking block whose prefix changed (compaction, expired tool history)
          // is dropped instead of failing the request. Models without the check accept it too.
          "anthropic-beta": "thinking-binding-controls-2026-08-01"
        }
      });
      const options = info.efforts.length === 0
        ? {}
        : level === "none"
          ? { thinking: { type: "disabled" as const } }
          : { thinking: { type: "adaptive" as const, display: "summarized" as const }, effort: level };
      return {
        info,
        model: anthropic(info.id),
        files: anthropic.files(),
        providerOptions: { anthropic: options satisfies AnthropicLanguageModelOptions },
        fileOptions: {}
      };
    }
    case "deepseek": {
      const deepSeek = createDeepSeek({ apiKey, baseURL });
      const options: DeepSeekLanguageModelOptions = level === "none"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled" }, reasoningEffort: level as "low" | "high" | "max" };
      return {
        info,
        model: deepSeek(info.id),
        files: deepSeek.files(),
        providerOptions: { deepseek: options },
        fileOptions: { deepseek: { expiresAfter } satisfies DeepSeekFilesOptions }
      };
    }
  }
}
