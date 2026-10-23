import { diffLines } from "diff";

const LINK_TARGET_RE = /\]\([^)]*\)/g;

function normalizeLinks(line) {
  return line.replace(LINK_TARGET_RE, "](LINK)");
}

/**
 * Builds a line-level diff between two texts, treating markdown link-target
 * changes as cosmetic when the surrounding text is otherwise identical
 * (e.g. GitHub restructuring where a policy doc lives - same policy, same
 * wording, just a URL path change). Filtering these out before the AI call:
 *
 *   1. Keeps the diff sent to the model free of noise that inflates
 *      "changes found" without any real change in meaning.
 *   2. Skips the AI call entirely when nothing substantive survives the
 *      filter (see watchman.js), saving cost/latency - directly serving
 *      the original "don't call the AI unless something real changed"
 *      design goal, one level more precise than hash-based detection alone.
 *
 * Real-world case this fixes: GitHub's site-policy commit 494824d
 * ("make images accessible in /images root directory") changes 16 lines,
 * every one of them purely a link path (e.g. /articles/foo -> /site-policy/foo),
 * identical surrounding prose. Before this filter, that surfaced as
 * "16 substantive changes". After, it correctly collapses to 0.
 */
export function buildFilteredDiff(oldText, newText) {
  const parts = diffLines(oldText, newText);
  const meaningfulLines = [];
  let cosmeticCount = 0;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];

    // A removed part immediately followed by an added part is the shape of
    // a "line(s) replaced" edit - the case worth checking for link-only changes.
    if (part.removed && parts[i + 1]?.added) {
      const removedLines = part.value.split("\n").filter(Boolean);
      const addedLines = parts[i + 1].value.split("\n").filter(Boolean);

      if (removedLines.length === addedLines.length && removedLines.length > 0) {
        const allCosmetic = removedLines.every((oldLine, j) => {
          const newLine = addedLines[j];
          return oldLine !== newLine && normalizeLinks(oldLine) === normalizeLinks(newLine);
        });

        if (allCosmetic) {
          cosmeticCount += removedLines.length;
          i += 2; // consumed both the removed and added part
          continue;
        }
      }
    }

    if (part.added || part.removed) {
      meaningfulLines.push(part.added ? `+ ${part.value}` : `- ${part.value}`);
    }
    i++;
  }

  return {
    rawDiff: meaningfulLines.join("\n"),
    cosmeticLinkChangesFiltered: cosmeticCount,
  };
}
