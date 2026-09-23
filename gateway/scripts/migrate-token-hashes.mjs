import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [location, persistOption, persistPath] = process.argv.slice(2);
if ((location !== "--local" && location !== "--remote") ||
    (persistOption !== undefined && (location !== "--local" || persistOption !== "--persist-to" || !persistPath)) ||
    process.argv.length > (persistOption ? 5 : 3)) {
  throw new Error("Usage: node scripts/migrate-token-hashes.mjs --local|--remote [--persist-to directory]");
}
const persistence = persistOption ? [persistOption, persistPath] : [];

function query(sql) {
  try {
    const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "chatext-gateway", location, ...persistence, "--command", sql, "--json"], { encoding: "utf8" });
    const [result] = JSON.parse(output);
    if (!result?.success) throw new Error("D1 query failed");
    return result.results;
  } catch {
    // A failed SELECT may contain bearer tokens in its captured output.
    throw new Error("Could not read the token table from D1");
  }
}

const columns = query("PRAGMA table_info(tokens)");
if (columns.some(({ name }) => name === "token_hash")) {
  console.log("Token hashes are already migrated.");
  process.exit(0);
}
if (!columns.some(({ name }) => name === "token")) {
  throw new Error("Initialize the D1 schema before migrating tokens.");
}

const rows = query("SELECT rowid AS id, token FROM tokens ORDER BY rowid");
const [{ count }] = query("SELECT COUNT(*) AS count FROM tokens");
if (rows.length !== count) throw new Error("Token query did not return every row; migration was not started.");
const updates = rows.map(({ id, token }) => {
  if (!Number.isSafeInteger(id) || typeof token !== "string") throw new Error("Unexpected token row");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  return `UPDATE tokens SET token_hash = '${hash}' WHERE rowid = ${id};`;
});

// The temporary SQL contains hashes and row IDs only; no bearer token is written to disk.
const directory = mkdtempSync(join(tmpdir(), "chatext-token-migration-"));
try {
  const file = join(directory, "migration.sql");
  writeFileSync(file, ["ALTER TABLE tokens RENAME COLUMN token TO token_hash;", ...updates].join("\n"), { mode: 0o600 });
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "chatext-gateway", location, ...persistence, "--file", file], { stdio: "pipe" });
  console.log(`Migrated ${rows.length} token hashes.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
