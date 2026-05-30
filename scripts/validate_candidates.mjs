// SPDX-License-Identifier: Apache-2.0
// Score candidate heuristic patterns: catch-rate on the MISSED attacks vs
// false-positive rate on benign+hardneg. Only patterns that add real catch
// with ~0 FP should ship.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { heuristicClassify } from "../src/heuristics.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const rows = (p) => { try { return readFileSync(resolve(ROOT, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { return []; } };

const exfil = rows("data/raw/exfil_external.jsonl").map((r) => r.prompt);
const jb = rows("data/raw/jailbreak_external.jsonl").map((r) => r.prompt);
const benign = [...rows("data/raw/benign.jsonl"), ...rows("data/raw/safe_hardneg.jsonl")].map((r) => r.prompt);

// only score on attacks the CURRENT heuristic MISSES (added value)
const missedExfil = exfil.filter((p) => !heuristicClassify(p));
const missedJb = jb.filter((p) => !heuristicClassify(p));

// CANDIDATE new patterns (generalizable attack techniques)
const candidates = [
  ["EXFIL structure-extract", /\b(?:first|last|next|nth|second|third)\s+(?:word|character|letter|line|sentence|paragraph|token)\s+(?:of|in|from)\s+(?:your|the|each)\s+(?:instructions?|prompt|system|message|secret|context)\b/i],
  ["EXFIL part-of-instructions", /\b(?:part|portion|section|rest|beginning|remainder)\s+of\s+(?:your|the)\s+(?:instructions?|prompt|system\s+prompt|context|message)\b/i],
  ["EXFIL secret-word", /\b(?:what\s+is|reveal|tell\s+me|repeat|give\s+me|share|spell|output)\b.{0,40}\b(?:the\s+)?(?:secret|concealed|hidden|protected|confidential)\s+(?:word|phrase|code|token|password|passphrase|key|string|sequence)\b/i],
  ["EXFIL encode-secret", /\b(?:encode|spell|reverse|translate|rot13|morse|acrostic)\b.{0,30}\b(?:the\s+)?(?:secret|password|instructions?|system\s+prompt)\b/i],
  ["INJECT prefix-force", /\b(?:start|begin)\s+(?:your\s+)?(?:response|reply|answer|message|output)\s+with\s+(?:the\s+(?:word|phrase|exact|sentence|secret)|["'`]|exactly)\b/i],
  ["INJECT respond-exactly", /\brespond\s+(?:only\s+|back\s+)?with\s+(?:exactly|the\s+exact|nothing\s+but|just\s+the)\b/i],
  ["JB roleplay-continue", /\b(?:do\s+not|don'?t|never)\s+(?:write|speak|respond|reply|act|talk)\s+as\s+(?:the\s+)?user\b/i],
  ["JB stay-in-character", /\b(?:stay|remain)\s+in\s+character\b|\b(?:do\s+not|don'?t|never)\s+break\s+character\b/i],
  ["JB no-restrictions", /\b(?:you\s+(?:have|are\s+free\s+of|are\s+without)|with|having)\s+no\s+(?:restrictions?|rules?|filters?|limits?|guidelines?|boundaries)\b/i],
];

// TIGHTENED replacements for over-broad existing patterns
const tightened = [
  ["TIGHT developer-mode", /\bdeveloper\s+mode\s+(?:enabled|output|response|active)\b|\benable\s+developer\s+mode\b.{0,40}\b(?:no\s+restrictions?|unrestricted|uncensored|anything|jailb)/i,
    /\bdeveloper\s+mode\b/i],
  ["TIGHT act-as", /\bact\s+as\s+(?:a|an|the)?\s*(?:dan|jailbroken|unrestricted|uncensored|unfiltered|evil|amoral|immoral|lawless)\b|\bact\s+as\s+(?:a|an|the)\b.{0,40}\b(?:no\s+(?:restrictions?|rules?|filter|ethics)|without\s+(?:any\s+)?(?:restrictions?|limits?|rules?)|can\s+(?:do|say)\s+anything)\b/i,
    /\bact\s+as\s+(?:a|an|if|though|the)\b/i],
];

function score(re, attacks, benignSet) {
  const caught = attacks.filter((p) => re.test(p)).length;
  const fp = benignSet.filter((p) => re.test(p)).length;
  return { caught, catchPct: (caught / attacks.length * 100), fp, fpPct: (fp / benignSet.length * 100) };
}

console.log("=== NEW candidate patterns (catch on MISSED attacks / FP on benign) ===");
console.log(`(missed pools: EXFIL=${missedExfil.length}, JB=${missedJb.length}; benign=${benign.length})\n`);
for (const [name, re] of candidates) {
  const isJb = name.startsWith("JB");
  const pool = isJb ? missedJb : missedExfil;
  const s = score(re, pool, benign);
  const verdict = s.fp === 0 ? "KEEP" : s.fpPct < 0.2 ? "CHECK" : "DROP";
  console.log(`[${verdict}] ${name}: catch ${s.caught}/${pool.length} (${s.catchPct.toFixed(1)}%)  FP ${s.fp} (${s.fpPct.toFixed(2)}%)`);
}

console.log("\n=== TIGHTENED replacements (new FP vs old FP; must keep JB catch) ===");
for (const [name, newRe, oldRe] of tightened) {
  const newFp = benign.filter((p) => newRe.test(p)).length;
  const oldFp = benign.filter((p) => oldRe.test(p)).length;
  const jbCatchNew = jb.filter((p) => newRe.test(p)).length;
  const jbCatchOld = jb.filter((p) => oldRe.test(p)).length;
  console.log(`${name}: FP ${oldFp} -> ${newFp}   | JB-catch ${jbCatchOld} -> ${jbCatchNew}`);
}
