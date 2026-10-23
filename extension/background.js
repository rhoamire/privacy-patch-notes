const BASE_URL = "http://localhost:3001";
const ALARM_NAME = "privacy-patch-notes-poll";

// Badge reflects the number of tracked sources whose LATEST detected change
// was high-risk - a quick at-a-glance signal without opening the popup.
// This is a convenience layer on top of the backend's own cron polling
// (src/server.js) - it doesn't trigger new fetches to tracked sites itself,
// it just asks our own backend what it already knows.
async function updateBadge() {
  try {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { sites } = await res.json();

    let highRiskCount = 0;
    for (const site of sites) {
      if (!site.lastChangedAt) continue;
      try {
        const detailRes = await fetch(`${BASE_URL}/status/${site.id}`);
        const detail = await detailRes.json();
        if (detail.lastSummary?.overall_risk_level === "high") {
          highRiskCount++;
        }
      } catch {
        // one source failing to fetch shouldn't block the badge for the rest
      }
    }

    if (highRiskCount > 0) {
      chrome.action.setBadgeText({ text: String(highRiskCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#c0685e" }); // matches --rose
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch {
    // Backend unreachable (e.g. not running locally) - clear the badge
    // rather than show stale/misleading state.
    chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 15 });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    updateBadge();
  }
});
