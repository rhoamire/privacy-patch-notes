import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data.sqlite");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// One row per tracked policy source (a "site").
db.exec(`
CREATE TABLE IF NOT EXISTS sites (
  id                  TEXT PRIMARY KEY,       -- e.g. 'github-tos'
  name                TEXT NOT NULL,          -- display name
  url                 TEXT NOT NULL,          -- source URL currently in use
  last_hash           TEXT,                   -- sha256 of last known content
  last_content        TEXT,                   -- last known raw text (for diffing)
  last_summary        TEXT,                   -- last AI-generated summary (JSON)
  last_checked_at     TEXT,                   -- ISO timestamp of last poll attempt
  last_changed_at     TEXT,                   -- ISO timestamp of last detected change
  status              TEXT NOT NULL DEFAULT 'unchecked', -- ok | stale | error | unchecked
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
`);

// History of detected changes, so we keep more than just "latest state".
db.exec(`
CREATE TABLE IF NOT EXISTS deltas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      TEXT NOT NULL REFERENCES sites(id),
  detected_at  TEXT NOT NULL,
  old_hash     TEXT,
  new_hash     TEXT NOT NULL,
  raw_diff     TEXT,     -- filtered text-level diff fed to the LLM
  ai_summary   TEXT      -- structured JSON summary from the AI diff step
);
`);

export function upsertSiteDefinition({ id, name, url }) {
  const existing = db.prepare("SELECT id FROM sites WHERE id = ?").get(id);
  if (!existing) {
    db.prepare(
      `INSERT INTO sites (id, name, url, status) VALUES (?, ?, ?, 'unchecked')`
    ).run(id, name, url);
  } else {
    // Keep url/name in sync with the registry file, but don't touch hash/content state.
    db.prepare(`UPDATE sites SET name = ?, url = ? WHERE id = ?`).run(name, url, id);
  }
}

export function getSite(id) {
  return db.prepare("SELECT * FROM sites WHERE id = ?").get(id);
}

export function getAllSites() {
  return db.prepare("SELECT * FROM sites").all();
}

export function recordPollResult({
  id,
  status,
  hash,
  content,
  checkedAt,
  changed,
}) {
  const failures =
    status === "error"
      ? (getSite(id)?.consecutive_failures ?? 0) + 1
      : 0;

  if (changed) {
    db.prepare(
      `UPDATE sites
       SET last_hash = ?, last_content = ?, last_checked_at = ?, last_changed_at = ?,
           status = ?, consecutive_failures = ?
       WHERE id = ?`
    ).run(hash, content, checkedAt, checkedAt, status, failures, id);
  } else {
    db.prepare(
      `UPDATE sites
       SET last_checked_at = ?, status = ?, consecutive_failures = ?
       WHERE id = ?`
    ).run(checkedAt, status, failures, id);
  }
}

export function insertDelta({ siteId, detectedAt, oldHash, newHash, rawDiff }) {
  const result = db.prepare(
    `INSERT INTO deltas (site_id, detected_at, old_hash, new_hash, raw_diff)
     VALUES (?, ?, ?, ?, ?)`
  ).run(siteId, detectedAt, oldHash, newHash, rawDiff);
  return result.lastInsertRowid;
}

export function saveDeltaSummary(deltaId, summaryJson) {
  db.prepare(`UPDATE deltas SET ai_summary = ? WHERE id = ?`).run(
    JSON.stringify(summaryJson),
    deltaId
  );
}

export function saveSiteSummary(siteId, summaryJson) {
  db.prepare(`UPDATE sites SET last_summary = ? WHERE id = ?`).run(
    JSON.stringify(summaryJson),
    siteId
  );
}

export function getDeltasForSite(id) {
  return db
    .prepare("SELECT * FROM deltas WHERE site_id = ? ORDER BY detected_at DESC")
    .all(id);
}
