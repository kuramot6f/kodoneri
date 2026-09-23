import catalog from "./models.json" with { type: "json" };

/** An API family; the extension and the gateway each keep one adapter per provider. */
export type Provider = keyof typeof catalog.providers;
export type Plan = keyof typeof catalog.plans;
/** "none" turns thinking off; an empty list means the model has no thinking control. */
export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
/** Who pays: the user's own key, or the chatext subscription through the gateway. */
export type Access = "byok" | "chatext";

/** USD per million tokens. */
interface Rates {
  input: number;
  cacheRead: number;
  cacheWrite?: number;
  output: number;
}

export interface Pricing extends Rates {
  /** Rates for the whole request once its input exceeds `above` tokens. */
  longContext?: Rates & { above: number };
  /** Every rate is multiplied during these [start, end) UTC hours, Monday to Friday. */
  peak?: { weekdayHoursUtc: [number, number][]; multiplier: number };
}

export interface CatalogModel {
  /** The id the provider's API takes; unique across providers. */
  id: string;
  provider: Provider;
  label: string;
  efforts: Effort[];
  contextWindow: number;
  pricing: Pricing;
}

export interface ModelInfo extends CatalogModel {
  /** `access:id`; what the settings store, since a model can be reached both ways. */
  key: string;
  access: Access;
}

export interface ModelSettings {
  /** A `ModelInfo.key`. */
  model: string;
  effort: Effort;
}

export const PROVIDERS = catalog.providers;
export const PLANS = catalog.plans as Record<Plan, string[]>;
export const CATALOG = catalog.models as CatalogModel[];
export const DEFAULT_MODEL_ID = "deepseek-flash";
export const DEFAULT_SETTINGS: ModelSettings = { model: modelKey("chatext", DEFAULT_MODEL_ID), effort: "low" };

export function modelKey(access: Access, id: string): string {
  return `${access}:${id}`;
}

export function findCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find((model) => model.id === id);
}

export function findModel(key: string): ModelInfo | undefined {
  const [access, id] = key.split(":");
  const model = id ? findCatalogModel(id) : undefined;
  return model && (access === "byok" || access === "chatext") ? { ...model, key, access } : undefined;
}

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && Object.hasOwn(PLANS, value);
}

/** Keeps the effort inside the model's range; the lowest level is the fallback. */
export function clampEffort(model: ModelInfo, effort: Effort): Effort {
  return model.efforts.includes(effort) ? effort : lowestEffort(model);
}

export function lowestEffort(model: ModelInfo): Effort {
  return model.efforts[0] ?? "none";
}
