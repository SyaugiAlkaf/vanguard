// SPDX-License-Identifier: Apache-2.0
// Analysis only: measure current heuristic coverage on the attack corpora and
// surface the most common phrase patterns in the MISSED attacks, so we can
// craft generalizable regex. Also measures current FP on benign+hardneg.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { heuristicClassify } from "../src/heuristics.mjs";

const ROOT = resolve(import.meta.dirname, "..");
function rows(p, labelField = "label") {
  try {
    return readFileSync(resolve(ROOT, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch { return []; }
}

const exfil = rows("data/raw/exfil_external.jsonl");
const jb = rows("data/raw/jailbreak_external.jsonl");
const benign = rows("data/raw/benign.jsonl");
const hardneg = rows("data/raw/safe_hardneg.jsonl");

function coverage(set, name) {
  let caught = 0;
  const missed = [];
  for (const r of set) {
    const h = heuristicClassify(r.prompt);
    if (h) caught++;
    else missed.push(r.prompt);
  }
  console.log(`${name}: ${set.length} attacks, heuristic caught ${caught} (${(caught / set.length * 100).toFixed(1)}%), missed ${missed.length}`);
  return missed;
}

function fpRate(set, name) {
  let fp = 0;
  const hits = [];
  for (const r of set) {
    const h = heuristicClassify(r.prompt);
    if (h) { fp++; if (hits.length < 8) hits.push(`[${h.label}] ${r.prompt.slice(0, 80)}`); }
  }
  console.log(`${name}: ${set.length} benign, heuristic FP ${fp} (${(fp / set.length * 100).toFixed(2)}%)`);
  for (const h of hits) console.log("   FP:", h);
  return fp;
}

console.log("=== current heuristic coverage on attacks ===");
const missedExfil = coverage(exfil, "EXFIL (SaTML)");
const missedJb = coverage(jb, "JAILBREAK (In-the-Wild)");
console.log("\n=== current heuristic FP on benign ===");
fpRate(benign, "benign");
fpRate(hardneg, "hard-neg");

// n-gram frequency on missed attacks (lowercased, alpha tokens)
function ngrams(prompts, n, top) {
  const freq = new Map();
  for (const p of prompts) {
    const toks = p.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i + n <= toks.length; i++) {
      const g = toks.slice(i, i + n).join(" ");
      freq.set(g, (freq.get(g) ?? 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

console.log("\n=== top 3-grams in MISSED EXFIL ===");
for (const [g, c] of ngrams(missedExfil, 3, 25)) console.log(`  ${c}\t${g}`);
console.log("\n=== top 4-grams in MISSED EXFIL ===");
for (const [g, c] of ngrams(missedExfil, 4, 20)) console.log(`  ${c}\t${g}`);
console.log("\n=== top 3-grams in MISSED JAILBREAK ===");
for (const [g, c] of ngrams(missedJb, 3, 20)) console.log(`  ${c}\t${g}`);
