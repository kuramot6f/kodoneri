import { gatewayUrl } from "./upstream.ts";

/**
 * Anthropic keeps uploaded files until they are deleted. The extension replays tool images for 6 hours
 * after the step that stored them; the extra hour covers the wait between the upload and that step.
 */
const FILE_TTL_MS = 7 * 60 * 60 * 1000;
/** Keeps a run within the Worker's subrequest limit; later runs finish a backlog. */
const MAX_DELETIONS = 500;

interface FilePage {
  data: { id: string; created_at: string }[];
  has_more: boolean;
  last_id: string | null;
}

/** Deletes the shared Anthropic account's files that no conversation can still reference. */
export async function deleteExpiredFiles(env: Env, now = Date.now()): Promise<void> {
  const base = `${gatewayUrl(env, "anthropic")}/v1/files`;
  const headers = {
    "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "files-api-2025-04-14"
  };
  const expired: string[] = [];
  let after: string | null = null;
  do {
    const response = await fetch(`${base}?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, { headers });
    if (!response.ok) throw new Error(`Anthropic file listing answered ${response.status}`);
    const page = await response.json() as FilePage;
    expired.push(...page.data.filter((file) => Date.parse(file.created_at) < now - FILE_TTL_MS).map((file) => file.id));
    after = page.has_more ? page.last_id : null;
  } while (after && expired.length < MAX_DELETIONS);

  for (const id of expired.slice(0, MAX_DELETIONS)) {
    const response = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404) console.error("Anthropic file could not be deleted", id, response.status);
  }
}
