import Groq from "groq-sdk";
import { z } from "zod";

const MODEL = "llama-3.3-70b-versatile";

// Lazily constructed: if this ran at module load time, a missing
// GROQ_API_KEY would crash the entire server on boot - including the
// hash-only change detection, which has nothing to do with the AI step and
// should keep working even without a key configured yet. Constructing it
// only when summarizeDelta() is actually called keeps that failure
// contained to the one thing that actually needs the key.
let groqClient = null;
function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const ChangeSchema = z.object({
  section: z.string().describe("Which part of the policy this change is in"),
  change_type: z.enum(["addition", "removal", "modification", "clarification"]),
  summary: z.string().describe("Plain-English explanation of what changed, one or two sentences"),
  risk_level: z.enum(["low", "medium", "high"]).describe(
    "User-facing risk: does this change reduce their privacy/control, or is it neutral/administrative"
  ),
});

const DiffSummarySchema = z.object({
  changes: z.array(ChangeSchema),
  overall_risk_level: z.enum(["low", "medium", "high"]),
});

const SYSTEM_PROMPT = `You are a policy analyst who explains legal document changes in plain English for ordinary users.

You will be given a line-level diff of a Terms of Service or Privacy Policy (lines prefixed with "+" are additions, "-" are removals).

Your job:
- Identify each DISTINCT substantive change (ignore whitespace/formatting-only diffs, typo fixes, or reordering with no meaning change).
- For each substantive change, classify it and explain it in plain English a non-lawyer would understand.
- Assign a risk_level based on impact to the USER's privacy/data rights, not the company's legal exposure:
  - "high": user loses rights, more data is collected/shared, new third parties involved, opt-out removed
  - "medium": ambiguous impact, procedural changes with unclear downstream effect
  - "low": clarifications, typo fixes, formatting, changes that don't affect user rights or data handling
- If the diff has NO substantive changes (pure formatting/typos), return an empty changes array and overall_risk_level "low".
- Never invent a change that isn't actually present in the diff.

Respond ONLY with valid JSON matching this exact shape, no markdown fences, no preamble:
{
  "changes": [
    { "section": string, "change_type": "addition"|"removal"|"modification"|"clarification", "summary": string, "risk_level": "low"|"medium"|"high" }
  ],
  "overall_risk_level": "low"|"medium"|"high"
}`;

export async function summarizeDelta({ siteName, rawDiff }) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set - check your .env file");
  }

  const completion = await getGroqClient().chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Source: ${siteName}\n\nDiff:\n${rawDiff}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`AI response was not valid JSON: ${err.message}\nRaw: ${raw}`);
  }

  const result = DiffSummarySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`AI response failed schema validation: ${result.error.message}`);
  }

  return result.data;
}
