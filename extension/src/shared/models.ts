import catalog from "./models.json" with { type: "json" };

export type Provider = keyof typeof catalog.providers;
/** "none" turns thinking off; an empty list means the model has no thinking control. */
export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
  id: string;
  provider: Provider;
  label: string;
  efforts: Effort[];
  contextWindow: number;
}

export interface ModelSettings {
  model: string;
  effort: Effort;
}

export const PROVIDERS = catalog.providers;
export const MODELS = catalog.models as ModelInfo[];
export const DEFAULT_SETTINGS: ModelSettings = { model: MODELS[0]!.id, effort: "medium" };

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}

/** Keeps the effort inside the model's range; the lowest level is the fallback. */
export function clampEffort(model: ModelInfo, effort: Effort): Effort {
  return model.efforts.includes(effort) ? effort : lowestEffort(model);
}

export function lowestEffort(model: ModelInfo): Effort {
  return model.efforts[0] ?? "none";
}
