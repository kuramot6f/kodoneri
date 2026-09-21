import { createAnthropic } from "@ai-sdk/anthropic";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { DeepSeekFilesOptions, DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { OpenAIFilesOptions, OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import type { LanguageModel, streamText, uploadFile } from "ai";
import { clampEffort, findModel, lowestEffort, MODELS } from "../shared/models";
import type { Effort, ModelInfo, ModelSettings, Provider } from "../shared/models";
import { TOOL_HISTORY_TTL_MS } from "../shared/conversation";

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

export type ApiKeys = Partial<Record<Provider, string>>;

let apiKeys: ApiKeys = {};

/** Asks the native app for the Keychain keys. Called on worker start, when the model menu opens and when a new conversation begins. */
export async function refreshApiKeys(): Promise<void> {
  const response = await browser.runtime.sendNativeMessage("application.id", { type: "apiKeys" }) as ApiKeys;
  apiKeys = Object.fromEntries(Object.entries(response).filter(([, key]) => typeof key === "string" && key));
}

export function availableModels(): ModelInfo[] {
  return MODELS.filter((model) => apiKeys[model.provider]);
}

/** Falls back to the first model with a key when the selected one has none. */
export function resolveSettings(settings: ModelSettings): ModelSettings | null {
  const model = findModel(settings.model);
  const info = model && apiKeys[model.provider] ? model : availableModels()[0];
  return info ? { model: info.id, effort: clampEffort(info, settings.effort) } : null;
}

export function createRuntime(settings: ModelSettings, effort: Effort | "lowest"): ModelRuntime {
  const info = findModel(settings.model);
  const apiKey = info && apiKeys[info.provider];
  if (!info || !apiKey) throw new Error("APIキーが設定されていません。chatextアプリでAPIキーを設定してください。");
  const level = effort === "lowest" ? lowestEffort(info) : clampEffort(info, effort);
  const expiresAfter = TOOL_HISTORY_TTL_MS / 1000;

  switch (info.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
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
      const anthropic = createAnthropic({ apiKey, headers: { "anthropic-dangerous-direct-browser-access": "true" } });
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
      const deepSeek = createDeepSeek({ apiKey });
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
