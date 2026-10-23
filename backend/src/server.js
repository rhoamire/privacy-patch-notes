import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { getAllSites, getDeltasForSite, getSite } from "./db.js";
import { pollAllSources, syncRegistryToDb } from "./watchman.js";

const PORT = process.env.PORT || 3001;
const POLL_SCHEDULE = process.env.POLL_SCHEDULE || "*/30 * * * *";

const app = express();
app.use(express.json());

syncRegistryToDb();

app.get("/status", (req, res) => {
  const sites = getAllSites().map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    status: s.status,
    lastCheckedAt: s.last_checked_at,
    lastChangedAt: s.last_changed_at,
    consecutiveFailures: s.consecutive_failures,
  }));
  res.json({ sites });
});

app.get("/status/:id", (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: "unknown source" });

  res.json({
    id: site.id,
    name: site.name,
    url: site.url,
    status: site.status,
    lastHash: site.last_hash,
    lastCheckedAt: site.last_checked_at,
    lastChangedAt: site.last_changed_at,
    lastSummary: site.last_summary ? JSON.parse(site.last_summary) : null,
  });
});

app.get("/status/:id/history", (req, res) => {
  const deltas = getDeltasForSite(req.params.id);
  res.json({ deltas });
});

app.post("/sync", async (req, res) => {
  const results = await pollAllSources();
  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`Privacy Patch Notes backend listening on :${PORT}`);
});

cron.schedule(POLL_SCHEDULE, async () => {
  console.log(`[watchman] poll cycle starting ${new Date().toISOString()}`);
  const results = await pollAllSources();
  console.log(`[watchman] poll cycle done:`, results);
});

console.log(`[watchman] scheduled with cron pattern "${POLL_SCHEDULE}"`);
