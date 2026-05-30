// SPDX-License-Identifier: Apache-2.0
import { completion } from "@qvac/sdk";
import { ALL_LABELS, LABELS } from "./labels.mjs";
import { buildClassifierMessages } from "./prompts.mjs";
import { heuristicClassify } from "./heuristics.mjs";
import { suspicionScan, suspicionLabel, SUSPICION_THRESHOLD } from "./suspicion.mjs";
import { normalizeForDetection } from "./normalize.mjs";

const VERDICT_RE = /\bverdict\s*[:\-]?\s*(SAFE|INJECTION|JAILBREAK|EXFILTRATION)\b/i;
// Pre-compiled at module load — avoids RegExp construction per classify().
const LABEL_BOUNDARY_RES = ALL_LABELS.map((label) => ({
  label,
  re: new RegExp(`\\b${label}\\b`),
}));

export function parseLabel(text) {
  const t = (text ?? "").toString();
  const m = t.match(VERDICT_RE);
  if (m) {
    const found = m[1].toUpperCase();
    return { label: found, fallback: false, mode: "verdict" };
  }
  const upper = t.toUpperCase();
  for (const { label, re } of LABEL_BOUNDARY_RES) {
    if (re.test(upper)) return { label, fallback: false, mode: "substring" };
  }
  return { label: LABELS.SAFE, fallback: true, mode: "fallback" };
}

const MAX_PROMPT_CHARS = 2400;

export async function classify({
  modelId,
  prompt,
  maxTokens = 60,
  skipHeuristics = false,
  mesh = null,
}) {
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new TypeError("classify requires a non-empty prompt string");
  }
  // Detection runs on the confusable-folded form so Unicode-disguised attacks
  // ("ignоre" with Cyrillic о, zero-width-joined, fullwidth) hit the same
  // regexes as plain ASCII. The model still receives the original prompt.
  const detect = normalizeForDetection(prompt);
  if (!skipHeuristics) {
    const h = heuristicClassify(detect);
    if (h) {
      return {
        label: h.label,
        blocked: h.blocked,
        raw: h.reason,
        latencyMs: 0,
        fallback: false,
        mode: "heuristic",
        stats: null,
      };
    }
  }
  if (mesh && typeof mesh.lookup === "function") {
    try {
      const meshHit = await mesh.lookup(detect);
      if (meshHit && meshHit.label) {
        return {
          label: meshHit.label,
          blocked: meshHit.label !== LABELS.SAFE,
          raw: `mesh signature ${meshHit.sig?.slice?.(0, 16) ?? "?"}... from device ${meshHit.deviceId ?? "?"}`,
          latencyMs: 0,
          fallback: false,
          mode: "mesh",
          stats: null,
          meshHit,
        };
      }
    } catch (_) {
      /* mesh failures are non-fatal — fall through to LoRA */
    }
  }
  const safePrompt =
    prompt.length > MAX_PROMPT_CHARS
      ? prompt.slice(0, MAX_PROMPT_CHARS) + " [truncated]"
      : prompt;
  const t0 = performance.now();
  const run = completion({
    modelId,
    history: buildClassifierMessages(safePrompt),
    stream: false,
    generationParams: { predict: maxTokens, reasoning_budget: 0 },
  });
  const final = await run.final;
  const t1 = performance.now();

  const raw =
    final?.contentText ??
    final?.cacheableAssistantContent ??
    final?.raw?.fullText ??
    "";
  const { label, fallback, mode } = parseLabel(raw);

  // Tier-1.5 suspicion escalation: when the LoRA says SAFE but several
  // soft attack markers co-occur, escalate to a block. Validated to add
  // zero false positives on the benign + hard-negative corpus.
  if (label === LABELS.SAFE) {
    const susp = suspicionScan(normalizeForDetection(safePrompt));
    if (susp.score >= SUSPICION_THRESHOLD) {
      const escalated = suspicionLabel(susp.categories);
      return {
        label: escalated,
        blocked: true,
        raw,
        latencyMs: t1 - t0,
        fallback: false,
        mode: "suspicion",
        suspicionCategories: susp.categories,
        stats: final?.stats ?? null,
      };
    }
  }

  return {
    label,
    blocked: label !== LABELS.SAFE,
    raw,
    latencyMs: t1 - t0,
    fallback,
    mode,
    stats: final?.stats ?? null,
  };
}
