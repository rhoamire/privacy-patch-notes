# Privacy Patch Notes — Browser Extension

A thin client over the backend built earlier in this project. It doesn't
fetch or analyze any policy itself — it just displays what the backend's
Watchman has already detected and cached, per the original design goal of
keeping the extension fast (no live scan on popup open).

## What's implemented

- **Popup** (`popup.html`/`.css`/`.js`) — lists every source the backend
  tracks, with a risk-colored badge (low/medium/high, or "no changes yet").
  Click a source to lazily load its change history (only fetched on
  expand, not upfront for every source).
- **Background service worker** (`background.js`) — polls the backend
  every 15 minutes and sets a toolbar badge count of sources whose most
  recent change was high-risk, so you get a signal without opening the
  popup. It only asks the backend what it already knows — it does not
  trigger new fetches to the tracked policy sites itself; that's still the
  backend's own cron job.
- **No external requests beyond the backend.** Deliberately no Google
  Fonts or CDN assets — system font stacks only. A privacy tool phoning
  home to a third party for its own styling would be a bad look, and it's
  unnecessary anyway.
- **HTML-escaping on all rendered text** — source names and AI-generated
  summaries are escaped before insertion, since both ultimately come from
  external sources (page titles, LLM output) and are rendered via
  `innerHTML`. Verified with a jsdom test injecting an
  `<img onerror=...>` payload as a source name — confirmed it renders as
  inert text, not executable markup.

## What's NOT implemented yet

- Options page (backend URL is hardcoded to `http://localhost:3001` — fine
  for local dev, would need to be configurable before any real deployment)
- Any UI for adding/removing tracked sources from the extension itself
  (that's still done by editing `src/sources.js` in the backend)
- Publishing to the Chrome Web Store

## Load it locally

1. Make sure the backend is running (`npm start` in the `backend` folder)
2. Open `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select this `extension` folder
5. Click the extension icon in your toolbar

## Testing notes

Every piece of `popup.js`'s rendering logic (relative-time formatting,
risk-badge mapping, expand/collapse, multi-change delta rendering, the
error state when the backend is unreachable, and HTML-escaping) was tested
against a simulated backend using jsdom before this was written to disk —
not just visually assumed to work. What I could NOT verify here: the
actual visual appearance in a real browser (no headless browser available
in the environment this was built in) and the real Manifest V3 runtime
behavior (service worker lifecycle, `chrome.action`/`chrome.alarms` APIs) —
those only exist in a real Chrome instance, so the load-unpacked step above
is the real first test of those parts.

## Design notes

Palette and layout deliberately avoid generic "AI-generated" defaults (see
project notes) — dark changelog-style background, muted diff-green/rose for
risk semantics (a functional choice tied to the product's actual purpose,
not decoration), monospace for structural labels (source names, timestamps)
paired with a plain sans for the actual summary text — the visual contrast
between "raw" chrome and "translated" content mirrors what the tool does:
turns dense legal diffs into plain English.
