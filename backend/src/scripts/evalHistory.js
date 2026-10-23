import "dotenv/config";
import { buildFilteredDiff } from "../diffFilter.js";
import { summarizeDelta } from "../ai.js";

const FILE_PATH = "Policies/github-terms/github-terms-of-service.md";
const REPO = "github/site-policy";
const N = Number(process.argv[2] ?? 5);

const ghHeaders = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

async function getCommitHistory() {
  const url = `https://api.github.com/repos/${REPO}/commits?path=${FILE_PATH}&per_page=${N + 1}`;
  const res = await fetch(url, { headers: ghHeaders });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function getFileAtCommit(sha) {
  const url = `https://raw.githubusercontent.com/${REPO}/${sha}/${FILE_PATH}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file at ${sha}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  console.log(`Fetching last ${N} commits touching ${FILE_PATH}...\n`);
  const commits = await getCommitHistory();

  if (commits.length < 2) {
    console.log("Not enough commit history found to build diffs.");
    return;
  }

  const pairs = [];
  for (let i = 0; i < Math.min(commits.length - 1, N); i++) {
    pairs.push({ newer: commits[i], older: commits[i + 1] });
  }

  let evaluated = 0;
  for (const { newer, older } of pairs) {
    console.log(`\n=== Commit ${newer.sha.slice(0, 7)} (${newer.commit.author.date}) ===`);
    console.log(`Message: ${newer.commit.message.split("\n")[0]}`);

    let oldText, newText;
    try {
      [oldText, newText] = await Promise.all([
        getFileAtCommit(older.sha),
        getFileAtCommit(newer.sha),
      ]);
    } catch (err) {
      console.log(`  Skipped (couldn't fetch file content): ${err.message}`);
      continue;
    }

    const { rawDiff, cosmeticLinkChangesFiltered } = buildFilteredDiff(oldText, newText);

    if (cosmeticLinkChangesFiltered > 0) {
      console.log(`  Filtered ${cosmeticLinkChangesFiltered} cosmetic link-path change(s) before sending to AI.`);
    }

    if (!rawDiff.trim()) {
      console.log("  No substantive diff remains after filtering - AI call skipped (matches production behavior).");
      evaluated++;
      continue;
    }

    try {
      const summary = await summarizeDelta({
        siteName: "GitHub Terms of Service",
        rawDiff,
      });
      console.log(`  AI found ${summary.changes.length} substantive change(s), overall risk: ${summary.overall_risk_level}`);
      for (const c of summary.changes) {
        console.log(`    - [${c.risk_level}] (${c.change_type}) ${c.section}: ${c.summary}`);
      }
      evaluated++;
    } catch (err) {
      console.log(`  AI summarization failed: ${err.message}`);
    }
  }

  console.log(`\n\nDone. Successfully evaluated ${evaluated}/${pairs.length} real commits.`);
  console.log(`Manually review the output above against each commit's actual diff on GitHub`);
  console.log(`(https://github.com/${REPO}/commits/main/${FILE_PATH}) to check for missed`);
  console.log(`changes or hallucinated ones - that comparison is your real accuracy number.`);
}

main().catch((err) => {
  console.error("Eval script failed:", err);
  process.exit(1);
});
