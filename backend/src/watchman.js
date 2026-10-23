import { extractText, hashContent } from "./hasher.js";
import { buildFilteredDiff } from "./diffFilter.js";
import { summarizeDelta } from "./ai.js";
import {
  getSite,
  insertDelta,
  recordPollResult,
  saveDeltaSummary,
  saveSiteSummary,
  upsertSiteDefinition,
} from "./db.js";
import { SOURCES } from "./sources.js";

const USER_AGENT = "PrivacyPatchNotes-Watchman/0.1 (+https://github.com/rhoamire)";
const MAX_CONSECUTIVE_FAILURES = 3;

export function syncRegistryToDb() {
  for (const source of SOURCES) {
    upsertSiteDefinition({ id: source.id, name: source.name, url: source.url });
  }
}

async function fetchSource(source) {
  const res = await fetch(source.url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${source.url}`);
  }

  const raw = await res.text();
  return source.contentType === "html" ? extractText(raw) : raw.trim();
}

export async function pollSource(source) {
  const checkedAt = new Date().toISOString();
  const existing = getSite(source.id);

  try {
    const text = await fetchSource(source);
    const newHash = hashContent(text);
    const oldHash = existing?.last_hash ?? null;
    const changed = oldHash !== null && oldHash !== newHash;
    const firstRun = oldHash === null;

    recordPollResult({
      id: source.id,
      status: "ok",
      hash: newHash,
      content: text,
      checkedAt,
      changed: changed || firstRun,
    });

    if (changed) {
      const { rawDiff, cosmeticLinkChangesFiltered } = buildFilteredDiff(
        existing.last_content ?? "",
        text
      );

      const deltaId = insertDelta({
        siteId: source.id,
        detectedAt: checkedAt,
        oldHash,
        newHash,
        rawDiff,
      });

      if (!rawDiff.trim()) {
        const autoSummary = {
          changes: [],
          overall_risk_level: "low",
          note: `Auto-filtered: ${cosmeticLinkChangesFiltered} cosmetic link-path change(s), no AI call made.`,
        };
        saveDeltaSummary(deltaId, autoSummary);
        saveSiteSummary(source.id, autoSummary);
        return {
          id: source.id,
          status: "changed",
          oldHash,
          newHash,
          summary: autoSummary,
          aiSkipped: true,
        };
      }

      try {
        const summary = await summarizeDelta({ siteName: source.name, rawDiff });
        saveDeltaSummary(deltaId, summary);
        saveSiteSummary(source.id, summary);
        return { id: source.id, status: "changed", oldHash, newHash, summary };
      } catch (aiErr) {
        console.error(`[watchman] AI summarization failed for ${source.id}:`, aiErr.message);
        return { id: source.id, status: "changed", oldHash, newHash, summaryError: aiErr.message };
      }
    }

    return { id: source.id, status: firstRun ? "baseline" : "unchanged", hash: newHash };
  } catch (err) {
    const failures = (existing?.consecutive_failures ?? 0) + 1;
    const status = failures >= MAX_CONSECUTIVE_FAILURES ? "stale" : "error";

    recordPollResult({
      id: source.id,
      status,
      hash: null,
      content: null,
      checkedAt,
      changed: false,
    });

    return { id: source.id, status: "error", error: err.message };
  }
}

export async function pollAllSources() {
  const results = [];
  for (const source of SOURCES) {
    results.push(await pollSource(source));
  }
  return results;
}
