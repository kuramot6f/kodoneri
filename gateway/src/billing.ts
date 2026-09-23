import type { JWSTransactionDecodedPayload, SignedDataVerifier } from "@apple/app-store-server-library";
import { importPKCS8, SignJWT } from "jose";

const PRODUCTS = {
  plus: { plan: "plus", allowanceMicrousd: 2_500_000 },
  pro: { plan: "pro", allowanceMicrousd: 10_000_000 }
} as const;

export const FREE_ALLOWANCE_MICROUSD = 200_000;

const APPLE_ROOTS = [
  "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"
].map((certificate) => Buffer.from(certificate, "base64"));

export type Plan = "free" | "plus" | "pro";

export interface BillingRow {
  user_id: string;
  app_account_token: string;
  plan: Plan;
  product_id: string | null;
  original_transaction_id: string | null;
  environment: StoreEnvironment | null;
  period_start: string | null;
  period_end: string | null;
  allowance_microusd: number;
  used_microusd: number;
  input_tokens: number;
  output_tokens: number;
  requests: number;
}

export async function ensureBilling(env: Env, userId: string, now = new Date()): Promise<BillingRow> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO billing (user_id, app_account_token) VALUES (?, ?)"
  ).bind(userId, crypto.randomUUID().toLowerCase()).run();
  let row = await selectBilling(env, userId);

  // A paid period that just ran out may already have renewed without us hearing, so ask the App Store once.
  if (row.plan !== "free" && effectivePlan(row, now) === "free" && row.original_transaction_id && row.environment) {
    await refreshSubscription(env, userId, row.original_transaction_id, row.environment)
      .catch((error) => console.error("App Store subscription status could not be refreshed", error));
    row = await selectBilling(env, userId);
  }
  return normalizeFree(env, row, now);
}

async function selectBilling(env: Env, userId: string): Promise<BillingRow> {
  const row = await env.DB.prepare("SELECT * FROM billing WHERE user_id = ?").bind(userId).first<BillingRow>();
  if (!row) throw new Error("billing row is missing");
  return row;
}

/** Moves a row without an active subscription onto the current free month. */
async function normalizeFree(env: Env, row: BillingRow, now = new Date()): Promise<BillingRow> {
  const userId = row.user_id;
  if (effectivePlan(row, now) === "free") {
    const { start, end } = freePeriod(now);
    await env.DB.prepare(`
      UPDATE billing
      SET plan = 'free', product_id = NULL, period_start = ?, period_end = ?, allowance_microusd = ?,
          used_microusd = CASE WHEN plan = 'free' AND period_start = ? THEN used_microusd ELSE 0 END,
          input_tokens = CASE WHEN plan = 'free' AND period_start = ? THEN input_tokens ELSE 0 END,
          output_tokens = CASE WHEN plan = 'free' AND period_start = ? THEN output_tokens ELSE 0 END,
          requests = CASE WHEN plan = 'free' AND period_start = ? THEN requests ELSE 0 END,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(
      start, end, FREE_ALLOWANCE_MICROUSD,
      start, start, start, start,
      userId
    ).run();
    return selectBilling(env, userId);
  }
  return row;
}

export function effectivePlan(row: BillingRow, now = new Date()): Plan {
  return row.plan !== "free" && row.period_end && new Date(row.period_end) > now ? row.plan : "free";
}

export function freePeriod(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Uses a signed transaction only to find whose subscription it is; the plan itself comes from the App Store,
 * because transactions arrive out of order (a renewal is issued before its period starts, an upgrade replaces it).
 */
export async function syncTransaction(env: Env, signedTransaction: string, expectedUserId?: string): Promise<BillingRow | null> {
  const { productId, appAccountToken, originalTransactionId, environment } = await verifyTransaction(env, signedTransaction);
  if (!productId || !Object.hasOwn(PRODUCTS, productId)) return null;
  if (!appAccountToken || !originalTransactionId || (environment !== "Sandbox" && environment !== "Production")) {
    throw new Error("transaction is missing required subscription fields");
  }

  const owner = await env.DB.prepare(
    "SELECT user_id FROM billing WHERE app_account_token = ?"
  ).bind(appAccountToken.toLowerCase()).first<{ user_id: string }>();
  if (!owner || (expectedUserId && owner.user_id !== expectedUserId)) throw new Error("transaction account does not match user");

  await refreshSubscription(env, owner.user_id, originalTransactionId, environment);
  return normalizeFree(env, await selectBilling(env, owner.user_id));
}

/** Stores the subscription's latest transaction as the App Store reports it now. */
async function refreshSubscription(env: Env, userId: string, originalTransactionId: string, environment: StoreEnvironment): Promise<void> {
  const transaction = await latestTransaction(env, originalTransactionId, environment);
  const product = transaction.productId ? PRODUCTS[transaction.productId as keyof typeof PRODUCTS] : undefined;
  const { transactionId, purchaseDate, expiresDate } = transaction;
  if (!product || !transactionId || !purchaseDate || !expiresDate) throw new Error("latest transaction is not a known subscription");

  const periodStart = new Date(purchaseDate).toISOString();
  // A refunded or revoked subscription ends when it was revoked, not when it would have expired.
  const periodEnd = new Date(transaction.revocationDate ?? expiresDate).toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO storekit_transactions
        (transaction_id, original_transaction_id, user_id, product_id, environment, purchased_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(transactionId, originalTransactionId, userId, transaction.productId, environment, periodStart, periodEnd),
    env.DB.prepare(`
      UPDATE billing
      SET plan = ?, product_id = ?, original_transaction_id = ?, latest_transaction_id = ?, environment = ?,
          period_start = ?, period_end = ?, allowance_microusd = ?,
          used_microusd = CASE WHEN period_start = ? THEN used_microusd ELSE 0 END,
          input_tokens = CASE WHEN period_start = ? THEN input_tokens ELSE 0 END,
          output_tokens = CASE WHEN period_start = ? THEN output_tokens ELSE 0 END,
          requests = CASE WHEN period_start = ? THEN requests ELSE 0 END,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(
      product.plan, transaction.productId, originalTransactionId, transactionId, environment,
      periodStart, periodEnd, product.allowanceMicrousd,
      periodStart, periodStart, periodStart, periodStart,
      userId
    )
  ]);
}

/** Asks the App Store Server API for the newest transaction of a subscription. */
async function latestTransaction(env: Env, originalTransactionId: string, environment: StoreEnvironment): Promise<JWSTransactionDecodedPayload> {
  const host = environment === "Production" ? "api.storekit.itunes.apple.com" : "api.storekit-sandbox.itunes.apple.com";
  const response = await fetch(`https://${host}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`, {
    headers: { authorization: `Bearer ${await appStoreToken(env)}` }
  });
  if (!response.ok) throw new Error(`App Store Server API answered ${response.status}`);
  const body = await response.json() as { data?: { lastTransactions?: { originalTransactionId?: string; signedTransactionInfo?: string }[] }[] };
  const signed = body.data?.flatMap((group) => group.lastTransactions ?? [])
    .find((item) => item.originalTransactionId === originalTransactionId)?.signedTransactionInfo;
  if (!signed) throw new Error("App Store has no status for this subscription");
  return verifyTransaction(env, signed);
}

async function appStoreToken(env: Env): Promise<string> {
  const key = await importPKCS8(env.APPLE_PRIVATE_KEY, "ES256");
  return new SignJWT({ bid: env.APPLE_BUNDLE_ID })
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID, typ: "JWT" })
    .setIssuer(env.APPLE_ISSUER_ID)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

export async function verifyNotification(env: Env, signedPayload: string): Promise<string | null> {
  const environment = readEnvironment(signedPayload);
  const notification = await (await verifier(env, environment)).verifyAndDecodeNotification(signedPayload);
  return notification.data?.signedTransactionInfo ?? null;
}

async function verifyTransaction(env: Env, signedTransaction: string): Promise<JWSTransactionDecodedPayload> {
  const environment = readEnvironment(signedTransaction);
  return (await verifier(env, environment)).verifyAndDecodeTransaction(signedTransaction);
}

async function verifier(env: Env, environment: StoreEnvironment): Promise<SignedDataVerifier> {
  const { Environment, SignedDataVerifier } = await import("@apple/app-store-server-library");
  const appAppleId = env.APPLE_APP_ID ? Number(env.APPLE_APP_ID) : undefined;
  if (environment === "Production" && (!appAppleId || !Number.isSafeInteger(appAppleId))) {
    throw new Error("APPLE_APP_ID is required for production StoreKit verification");
  }
  const libraryEnvironment = environment === "Production" ? Environment.PRODUCTION : Environment.SANDBOX;
  return new SignedDataVerifier(APPLE_ROOTS, false, libraryEnvironment, env.APPLE_BUNDLE_ID, appAppleId);
}

type StoreEnvironment = "Sandbox" | "Production";

function readEnvironment(jws: string): StoreEnvironment {
  const payload = jws.split(".")[1];
  if (!payload) throw new Error("invalid JWS");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { environment?: unknown; data?: { environment?: unknown } };
  const value = decoded.environment ?? decoded.data?.environment;
  if (value === "Sandbox" || value === "Production") return value;
  throw new Error("unsupported StoreKit environment");
}
