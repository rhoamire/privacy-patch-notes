import { createHash } from "node:crypto";
import { parse } from "node-html-parser";

/**
 * SHA-256 over normalized text. Using SHA-256 rather than MD5 -
 * no functional reason to reach for a weaker hash when we're not
 * bound by legacy constraints.
 */
export function hashContent(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Strips a raw HTML page down to visible policy text.
 *
 * Strategy: WHITELIST the main content container when the page has one
 * (<main>, <article>, or a role="main" element), rather than only
 * blacklisting known noise tags (nav/footer/header/script/style).
 *
 * This exists because of a real finding: GitLab's handbook pages
 * (handbook.gitlab.com) render their entire site navigation - literally
 * thousands of handbook page titles - in a sidebar that is NOT a <nav>
 * element. A blacklist-only approach let that whole sidebar leak into the
 * extracted text, which would make our hash change every time GitLab edits
 * ANY handbook page company-wide, not just the policy we're tracking.
 * Whitelisting <main>/<article> when present sidesteps that entirely,
 * since noise containers we haven't specifically anticipated are simply
 * never included, rather than needing to be named and excluded one by one.
 *
 * Falls back to the blacklist approach for pages with no clear main/article
 * container (e.g. GitHub's raw markdown never even reaches this function -
 * it's contentType: 'markdown' - but a simpler HTML page might lack
 * semantic landmarks entirely).
 */
export function extractText(html) {
  const root = parse(html, {
    blockTextElements: { script: false, style: false, noscript: false },
  });

  const mainContent =
    root.querySelector("main") ||
    root.querySelector("article") ||
    root.querySelector('[role="main"]');

  const scope = mainContent || root;

  // Even within a whitelisted main/article container, strip obviously
  // non-content elements (embedded scripts, a same-page table of contents,
  // "edit this page" links) that some themes place inside <main> itself.
  scope
    .querySelectorAll("script, style, noscript, nav, footer, header, aside")
    .forEach((el) => el.remove());

  const text = scope.structuredText || scope.textContent || "";

  // Even inside main/article, some site generators append per-page
  // metadata chrome (a "last modified" stamp with commit hash, "edit this
  // page" / "view page source" links). Real, observed case: GitLab's
  // handbook footer includes "Last modified <date>: <commit message>
  // (<hash>)" INSIDE <main> itself. That line updates on every edit to the
  // page - including trivial ones (we've directly seen a real "Remove
  // trailing spaces" commit trigger exactly this) - which would cause our
  // hash to register a "change" on pure noise, before the content even
  // reaches the cosmetic-diff filter or the AI. Drop lines matching this
  // shape rather than the real policy text.
  const CHROME_LINE_PATTERNS = [
    /^Last modified .+:.+\([0-9a-f]{7,}\)$/i, // "Last modified <date>: <msg> (<short-sha>)"
    /^View page source-?$/i,
    /^Edit this page-?$/i,
    /^please contribute\.?$/i,
  ];

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !CHROME_LINE_PATTERNS.some((re) => re.test(line)))
    .join("\n");
}
