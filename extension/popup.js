const BASE_URL = "http://localhost:3001";

const contentEl = document.getElementById("content");
const sourceCountEl = document.getElementById("source-count");
const backendIndicatorEl = document.getElementById("backend-indicator");

/** Cache of per-source detail (history) fetched lazily on expand. */
const detailCache = new Map();

function relativeTime(isoString) {
  if (!isoString) return "never checked";
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function riskClass(risk) {
  if (risk === "low" || risk === "medium" || risk === "high") return risk;
  return "none";
}

function riskLabel(risk) {
  switch (risk) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
    default:
      return "No changes yet";
  }
}

function statusLine(source) {
  if (source.status === "error") return "fetch failing";
  if (source.status === "stale") return "fetch failing (stale)";
  if (source.status === "unchecked") return "not yet checked";
  const changed = source.lastChangedAt ? relativeTime(source.lastChangedAt) : null;
  const checked = relativeTime(source.lastCheckedAt);
  return changed ? `changed ${changed} \u00b7 checked ${checked}` : `checked ${checked}`;
}

function renderSources(sources) {
  sourceCountEl.textContent = String(sources.length);

  if (sources.length === 0) {
    contentEl.innerHTML = `<div class="state">No sources configured on the backend yet.</div>`;
    return;
  }

  contentEl.innerHTML = "";
  for (const source of sources) {
    contentEl.appendChild(renderSourceCard(source));
  }
}

function renderSourceCard(source) {
  const card = document.createElement("div");
  card.className = `source-card source-card--risk-${riskClass(source.lastRisk)}`;

  const button = document.createElement("button");
  button.className = "source-card__button";
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `
    <div class="source-card__main">
      <div class="source-card__name">${escapeHtml(source.name)}</div>
      <div class="source-card__meta">${escapeHtml(statusLine(source))}</div>
    </div>
    <span class="risk-pill risk-pill--${riskClass(source.lastRisk)}">${riskLabel(source.lastRisk)}</span>
    <span class="chevron" aria-hidden="true">\u203a</span>
  `;

  const detail = document.createElement("div");
  detail.className = "source-card__detail";
  detail.hidden = true;

  button.addEventListener("click", async () => {
    const isOpen = card.classList.toggle("source-card--open");
    button.setAttribute("aria-expanded", String(isOpen));
    detail.hidden = !isOpen;

    if (isOpen && !detailCache.has(source.id)) {
      detail.innerHTML = `<div class="detail-empty">Loading history\u2026</div>`;
      try {
        const history = await fetchHistory(source.id);
        detailCache.set(source.id, history);
        renderHistory(detail, history);
      } catch (err) {
        detail.innerHTML = `<div class="detail-empty">Couldn't load history: ${escapeHtml(err.message)}</div>`;
      }
    } else if (isOpen) {
      renderHistory(detail, detailCache.get(source.id));
    }
  });

  card.appendChild(button);
  card.appendChild(detail);
  return card;
}

function renderHistory(detailEl, deltas) {
  if (!deltas || deltas.length === 0) {
    detailEl.innerHTML = `<div class="detail-empty">No changes detected yet.</div>`;
    return;
  }

  detailEl.innerHTML = "";
  for (const delta of deltas.slice(0, 8)) {
    for (const entryEl of buildDeltaEntryElements(delta)) {
      detailEl.appendChild(entryEl);
    }
  }
}

/** Returns an array of .change-item elements for one delta row - one per
 * substantive change the AI found, or a single "no substantive change"
 * entry if the delta was auto-filtered (cosmetic-only) or has none. */
function buildDeltaEntryElements(delta) {
  const when = relativeTime(delta.detected_at);

  let summary;
  try {
    summary = delta.ai_summary ? JSON.parse(delta.ai_summary) : null;
  } catch {
    summary = null;
  }

  if (!summary || !summary.changes || summary.changes.length === 0) {
    const div = document.createElement("div");
    div.className = "change-item";
    div.innerHTML = `
      <div class="change-item__head">
        <span class="change-item__section">${escapeHtml(when)}</span>
      </div>
      <div class="change-item__summary">No substantive changes (cosmetic or formatting only).</div>
    `;
    return [div];
  }

  return summary.changes.map((c) => {
    const div = document.createElement("div");
    div.className = "change-item";
    div.innerHTML = `
      <div class="change-item__head">
        <span class="risk-pill risk-pill--${riskClass(c.risk_level)}">${riskLabel(c.risk_level)}</span>
        <span class="change-item__section">${escapeHtml(c.section)} \u00b7 ${escapeHtml(when)}</span>
      </div>
      <div class="change-item__summary">${escapeHtml(c.summary)}</div>
    `;
    return div;
  });
}

async function fetchHistory(sourceId) {
  const res = await fetch(`${BASE_URL}/status/${sourceId}/history`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.deltas;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function loadStatus() {
  try {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // /status doesn't include risk level directly - fetch per-source detail
    // for the ones that have actually changed, to get lastSummary.risk.
    // Kept sequential and small (few sources) rather than Promise.all-ing
    // an unbounded list against a local dev server.
    const enriched = [];
    for (const s of data.sites) {
      if (s.lastChangedAt) {
        try {
          const detailRes = await fetch(`${BASE_URL}/status/${s.id}`);
          const detail = await detailRes.json();
          enriched.push({
            ...s,
            lastRisk: detail.lastSummary?.overall_risk_level ?? null,
          });
          continue;
        } catch {
          // fall through to unenriched push below
        }
      }
      enriched.push({ ...s, lastRisk: null });
    }

    renderSources(enriched);
    backendIndicatorEl.textContent = "backend connected";
    backendIndicatorEl.className = "backend-indicator backend-indicator--ok";
  } catch (err) {
    contentEl.innerHTML = `
      <div class="state state--error">
        <p>Can't reach the backend at ${escapeHtml(BASE_URL)}.</p>
        <p class="state__hint">Run <code>npm start</code> in the backend folder, then reopen this popup.</p>
      </div>
    `;
    backendIndicatorEl.textContent = "backend unreachable";
    backendIndicatorEl.className = "backend-indicator backend-indicator--error";
  }
}

loadStatus();
