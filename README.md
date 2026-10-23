# Privacy Patch Notes

**Privacy Patch Notes** is a Manifest V3 browser extension with a Node.js backend that watches selected Terms of Service and privacy-policy documents, detects content changes, filters cosmetic diffs, and generates structured plain-English summaries with an LLM.

The current version is an early working prototype. The extension uses vanilla JavaScript, HTML, and CSS; a React/TypeScript UI is a possible future iteration, not part of this repository's current implementation.

## Current functionality

- Polls the policy sources configured in the backend and stores a SHA-256 content hash for change detection.
- Records detected changes in SQLite, retaining filtered line-level diffs instead of only overwriting the current state.
- Filters a class of cosmetic Markdown-link-target changes and skips the LLM call when no substantive diff remains after filtering.
- Uses the Groq API to summarize detected diffs and validates structured JSON output with Zod before storing it.
- Runs scheduled polling in the backend; the API also supports manually triggering a sync and retrieving current status and history.
- Extracts text from HTML sources using main-content landmarks where available, reducing noise from unrelated site navigation.

## Architecture

```text
Configured policy source
        |
        v
Backend poller (cron)
        |
        v
Extract content + SHA-256 hash
        |
        v
Compare with stored version
        |
        v
Line-level diff + cosmetic-diff filter
        |
        v
Groq summarization (when substantive changes remain)
        |
        v
Zod schema validation
        |
        v
SQLite change history + status API
        |
        v
Manifest V3 extension popup
```

## Repository structure

```text
privacy-patch-notes/
├── extension/   # Manifest V3 popup and background service worker
└── backend/     # Express API, source polling, diff processing, AI and SQLite
```

## Source coverage and validation status

The configured sources are:

- **GitHub Terms of Service** — sourced as raw Markdown from GitHub's public `site-policy` repository. The backend README documents a verified baseline/unchanged/changed cycle and evaluation of real historical GitHub policy changes.
- **GitLab Website Terms of Use** — sourced from the rendered handbook page. The source is configured and the extraction logic has been tested against a synthetic page shape, but the backend README explicitly notes that live fetching and extraction still need confirmation on a machine that can reach the site.

The current version does **not** offer broad arbitrary-URL monitoring. Additional sources and a dedicated policy-change API are future work; their coverage should be verified before describing them as supported.

## Getting started

### 1. Start the backend

Open PowerShell in the repository root and run:

```powershell
Set-Location .\backend
npm ci
Copy-Item .env.example .env
```

Edit `backend/.env` and set `GROQ_API_KEY` to your own key. Do not commit `.env` or share its contents. The backend can still boot and perform hash-based detection without a Groq key, but AI summaries will not work.

Start the backend:

```powershell
npm start
```

By default, it listens on port `3001`. The backend README documents all endpoints and evaluation commands.

To trigger a poll manually, use a separate PowerShell window:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/sync
```

Useful endpoints:

- `GET /status` — status of all sources
- `GET /status/:id` — status and latest summary for one source
- `GET /status/:id/history` — stored change history
- `POST /sync` — manually trigger a poll cycle

### 2. Load the extension

1. Open your Chromium-based browser's extension management page.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the `extension/` directory.
4. Keep the backend running locally; the current extension manifest grants access to `http://localhost:3001/*`.

This is a local prototype setup, not a hosted production deployment.

## Evaluation

The backend provides an evaluation script for summarizing real historical GitHub policy changes:

```powershell
Set-Location .\backend
npm run eval
npm run eval -- 20
```

The backend README describes the most recent documented run as 19 of 19 historical changes manually verified, including cosmetic-only and no-op cases. Treat this as the recorded result of that evaluation run, not as a guarantee of general summarization accuracy.

## Privacy and security notes

- Keep credentials in environment variables and commit `.env.example` with placeholders only.
- Do not commit `data.sqlite`, `data.sqlite-shm`, `data.sqlite-wal`, or any local browsing/policy-history database. Provide clean fixtures if demo data is needed.
- The extension currently talks to a locally running backend. Before deploying it, review the API exposure, authentication needs, hosting configuration, and privacy implications of storing policy-change history.
- Summaries are intended to assist review; users should consult the source policy for authoritative wording.

## Technology stack

- **Browser extension:** Manifest V3, JavaScript, HTML, CSS
- **Backend/API:** Node.js, Express
- **Storage:** SQLite (`better-sqlite3`)
- **Change processing:** SHA-256 hashing, line-level diffs, cosmetic-diff filtering
- **LLM and validation:** Groq API, Zod
- **Scheduling and HTML parsing:** `node-cron`, `node-html-parser`

## Roadmap

- Confirm live GitLab source retrieval and content extraction.
- Add further policy sources through a source-adapter interface, or evaluate a dedicated policy-change API after validating its coverage and terms.
- Improve the extension UI after the initial repository baseline is published.
- Add repeatable tests and clean fixtures for change detection and summarization.
- Consider deployment and extension-store publication after operational and privacy requirements are addressed.
