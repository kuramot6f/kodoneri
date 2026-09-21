import catalog from "./models.json" with { type: "json" };

export type Provider = keyof typeof catalog.providers;
/** "none" turns thinking off; an empty list means the model has no thinking control. */
export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
  /** `provider/id`; what the settings store, since the same upstream id can appear under two providers. */
  key: string;
  /** The id the provider's API takes. */
  id: string;
  provider: Provider;
  label: string;
  efforts: Effort[];
  contextWindow: number;
}

export interface ModelSettings {
  /** A `ModelInfo.key`. */
  model: string;
  effort: Effort;
}

export const PROVIDERS = catalog.providers;
export const MODELS: ModelInfo[] = (catalog.models as Omit<ModelInfo, "key">[]).map((model) => ({ ...model, key: `${model.provider}/${model.id}` }));
export const DEFAULT_SETTINGS: ModelSettings = { model: MODELS[0]!.key, effort: "medium" };

export function findModel(key: string): ModelInfo | undefined {
  return MODELS.find((model) => model.key === key);
}

/** Keeps the effort inside the model's range; the lowest level is the fallback. */
export function clampEffort(model: ModelInfo, effort: Effort): Effort {
  return model.efforts.includes(effort) ? effort : lowestEffort(model);
}

export function lowestEffort(model: ModelInfo): Effort {
  return model.efforts[0] ?? "none";
}
