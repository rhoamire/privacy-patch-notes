/**
 * Source registry.
 *
 * Each entry describes HOW to find a platform's policy text, not just a
 * static URL. Right now only 'static' strategy is implemented (a fixed
 * URL), but the shape leaves room for a 'discover' strategy later
 * (e.g. follow a footer link, hit a platform's own changelog API) without
 * touching the watchman/poller code.
 *
 * Sources are chosen deliberately, not just for convenience - see the two
 * entries below for two very different outcomes of that evaluation:
 *
 * - github-tos: clean markdown, openly licensed for reuse (public repo
 *   meant for exactly this kind of consumption), permissive robots.txt.
 * - gitlab-website-terms: real HTML (tests the extractText() HTML-stripping
 *   path, which github-tos never exercises since it's markdown), hosted on
 *   handbook.gitlab.com - a domain GitLab explicitly keeps open per their
 *   "radical transparency" culture, with a robots.txt that only disallows
 *   narrow routes (search, admin, API), never a blanket disallow.
 *
 * Reddit's User Agreement was evaluated and deliberately NOT added: their
 * robots.txt (updated mid-2024) disallows all automated access site-wide,
 * as a deliberate policy decision tied to their own paid data-licensing
 * deals - not an incidental bot-detection side effect. Respecting that is
 * the same principle this project follows for GitHub/GitLab: prefer
 * sources that are actually open for this kind of access, don't route
 * around ones that explicitly aren't.
 */
export const SOURCES = [
  {
    id: "github-tos",
    name: "GitHub Terms of Service",
    strategy: "static",
    url: "https://raw.githubusercontent.com/github/site-policy/main/Policies/github-terms/github-terms-of-service.md",
    contentType: "markdown", // markdown needs no HTML stripping, unlike a live privacy-center page
  },
  {
    id: "gitlab-website-terms",
    name: "GitLab Website Terms of Use",
    strategy: "static",
    url: "https://handbook.gitlab.com/handbook/legal/policies/website-terms-of-use",
    contentType: "html", // rendered Hugo page - exercises extractText()'s nav/footer stripping
  },
  // Add more sources here as the resolver proves itself, e.g.:
  // {
  //   id: "reddit-user-agreement",
  //   name: "Reddit User Agreement",
  //   strategy: "static",
  //   url: "https://www.redditinc.com/policies/user-agreement",
  //   contentType: "html",
  // }, -- deliberately not added, see comment above.
];
