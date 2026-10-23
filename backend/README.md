# Privacy Patch Notes — Backend (Watchman + AI Summarizer)

Two real, live sources tracked end-to-end: GitHub's Terms of Service and
GitLab's Website Terms of Use. Hash-based change detection, a cosmetic-diff
filter, and AI summarization are all implemented and verified against real
data (see "Verified behavior" below for exactly what's been checked and how).

## What's implemented

- **Watchman poller** (`src/watchman.js`) — fetches each source in
  `src/sources.js`, hashes the content (SHA-256), compares against the last
  known hash.
- **Background cron schedule** (`src/server.js`) — polling runs
  independently of any HTTP request; `GET /status/:id` is always a fast
  cached read.
- **Delta history** (`deltas` table) — every detected change stored with a
  filtered line-level diff, not just overwritten.
- **AI diff summarization** (`src/ai.js`) — Groq (`llama-3.3-70b-versatile`,
  temp 0.4), structured JSON output validated with Zod before storage. The
  Groq client is lazily constructed (only on first real call) specifically
  so a missing `GROQ_API_KEY` fails the AI step alone, not the whole server
  — this was a real bug caught during testing (see below).
- **Cosmetic-link pre-filter** (`src/diffFilter.js`) — strips line-pairs
  that differ only in a markdown link target (e.g. a doc's URL path
  changing, same surrounding text), and skips the AI call entirely when
  nothing substantive survives filtering.
- **Content extraction, whitelist-based** (`src/hasher.js`,
  `extractText()`) — for HTML sources, isolates `<main>`/`<article>`/
  `[role="main"]` when present, rather than only blacklisting known noise
  tags. See "Real bugs found" below for why this changed.

## Sources tracked

- **`github-tos`** — GitHub Terms of Service, raw markdown from their
  public `site-policy` repo. Clean text, openly licensed for reuse,
  permissive robots.txt.
- **`gitlab-website-terms`** — GitLab Website Terms of Use, rendered HTML
  from `handbook.gitlab.com`. Chosen deliberately to exercise the HTML
  extraction path (github-tos is markdown and never touches it), and
  because GitLab's robots.txt only disallows narrow routes (search, admin,
  API) — never a blanket disallow.

**Reddit's User Agreement was evaluated and deliberately NOT added.**
Reddit's robots.txt (updated mid-2024) disallows all automated access
site-wide, as a deliberate policy tied to their own paid data-licensing
deals (e.g. a $60M Google deal) — not an incidental bot-detection side
effect. Respecting that is the same principle this project follows for
GitHub/GitLab: use sources that are actually open for this kind of access,
don't route around ones that explicitly aren't. ToS;DR (tosdr.org) was also
evaluated as a third-party aggregator — its data is genuinely openly
licensed (CC BY-SA 3.0), but its API returns curated point-by-point
analysis, not full document text, so it doesn't fit this project's
hash-and-diff pipeline without separate "curated-source" handling — noted
as a possible future source type, not built yet.

## Real bugs found during this build (not hypothetical)

1. **Cosmetic link-path noise inflating change counts.** GitHub commit
   `494824d` ("make images accessible in /images root directory") changed
   16 lines that were purely link-path restructuring (same text, different
   URL) — surfaced as "16 substantive changes" before the filter existed.
   Fixed in `diffFilter.js`, verified against the real commit and against a
   synthetic case mixing a cosmetic change with a genuine wording change in
   the same commit (confirms the filter doesn't over-suppress).
2. **Server crashed on boot with no Groq key.** The Groq client was
   constructed at module-load time, so importing `ai.js` — which happens
   just by starting the server — threw immediately if `GROQ_API_KEY` was
   unset, killing hash-only change detection along with it. Fixed by making
   the client lazy (constructed on first real `summarizeDelta()` call).
   Verified: server now boots and serves `/status` correctly with zero env
   vars set.
3. **HTML extraction leaking an entire site's navigation.** GitLab's
   handbook page renders its full site nav (thousands of unrelated page
   titles) in a sidebar that isn't a `<nav>` element, so the original
   blacklist-based `extractText()` would have included all of it — meaning
   the hash would change whenever GitLab edited ANY handbook page
   company-wide, not just the tracked policy. Fixed by switching to a
   whitelist approach (isolate `<main>`/`<article>` when present). Verified
   with a synthetic test replicating the real page's shape (sidebar outside
   `<main>`, real content inside).

## Setup

```bash
npm install
cp .env.example .env
# paste your real GROQ_API_KEY into .env (AI summaries won't work without
# it, but the server now boots and hash-based detection works fine either way)
npm start
```

```bash
curl -X POST http://localhost:3001/sync
```

(Windows PowerShell: use `curl.exe -X POST ...`, not the `curl` alias.)

## Endpoints

| Method | Path                  | Purpose                                            |
|--------|-----------------------|-----------------------------------------------------|
| GET    | `/status`              | Overview of all tracked sources                    |
| GET    | `/status/:id`           | Single source's current state incl. latest AI summary |
| GET    | `/status/:id/history`   | Full delta history for a source                    |
| POST   | `/sync`                | Manually trigger a poll cycle (all sources)         |

## Config (`.env`)

- `GROQ_API_KEY` — required for AI summarization; hash-only detection works without it
- `PORT` — default `3001`
- `POLL_SCHEDULE` — cron pattern, default `*/30 * * * *`
- `GITHUB_TOKEN` — optional, raises the eval script's GitHub API rate limit

## Evaluating the AI summarizer against real history

```bash
npm run eval          # last 5 real historical GitHub ToS changes
npm run eval -- 20    # last 20
```

Fetches real commit pairs from `github/site-policy`, builds the actual
diff, runs the summarizer, prints results for manual cross-check against
the real commits on GitHub. Last full run: **19/19 real historical commits
manually verified correct** — including catching a single trailing-
whitespace-only change, several no-op/workflow commits, and (after the
cosmetic-link fix) correctly collapsing the 16-line link-restructuring
commit to zero substantive changes without losing any of the genuinely
substantive changes elsewhere in that same commit.

## Verified behavior

- GitHub source: full baseline → unchanged → changed cycle confirmed
  end-to-end, multiple times, across sessions (same content hash
  reproduced independently on two different machines).
- GitLab source: registers correctly, fetch code runs — but the actual live
  fetch and the nav-extraction fix have **not** been confirmed against real
  traffic yet, because the sandbox used to build this can't reach
  `handbook.gitlab.com` (network allowlist restriction, confirmed via
  direct `curl -v`, unrelated to GitLab itself). The extraction logic is
  verified only against a synthetic test replicating the real page's
  reported shape. **This needs to be confirmed on a real machine before
  trusting it** — run `npm run start` + `curl -X POST .../sync` and check
  `/status/gitlab-website-terms` for a real hash and reasonable content
  length, not an error.
- AI/schema layer: valid model output passes Zod validation, malformed
  output is correctly rejected — verified with hand-built mock responses.
- Server boot: confirmed working with zero environment variables set (no
  `.env` at all) — hash-only detection functions fully without a Groq key.

## Next steps

1. ~~Hash + poll + cache for one hardcoded source~~ ✅
2. ~~AI diff step + structured summary~~ ✅
3. ~~Evaluate against real historical data, fix what eval surfaces~~ ✅
4. **Confirm the GitLab source's real fetch + extraction on an actual
   machine** — this is the one open item, since the build sandbox can't
   reach that domain
5. Add a 3rd source once GitLab is confirmed, ideally one with no clear
   `<main>`/`<article>` landmark, to stress-test the blacklist fallback path
6. Build the extension as a thin client, once the API contract is stable
7. Deploy (Railway/Render) + publish extension to Chrome Web Store
