// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { heuristicClassify } from "../src/heuristics.mjs";
import { ALL_LABELS, LABELS } from "../src/labels.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const VAL = process.argv[2] ?? resolve(ROOT, "data/sft/val.jsonl");
const REPORT_OUT = process.argv[3] ?? resolve(ROOT, "artifacts/training/heuristic_only_eval.json");

function loadVal(p) {
  return readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .map((o) => {
      const u = o.messages.find((m) => m.role === "user")?.content ?? "";
      const a = (o.messages.find((m) => m.role === "assistant")?.content ?? "").trim().toUpperCase();
      const truth = ALL_LABELS.find((L) => a.startsWith(L)) ?? a;
      return { prompt: u, truth };
    })
    .filter((r) => r.prompt && ALL_LABELS.includes(r.truth));
}

const rows = loadVal(VAL);
console.log(`[bench] val rows: ${rows.length}`);

const matrix = Object.fromEntries(
  ALL_LABELS.map((t) => [t, Object.fromEntries(ALL_LABELS.map((p) => [p, 0]))]),
);

let heuristicHits = 0;
for (const r of rows) {
  const h = heuristicClassify(r.prompt);
  const pred = h?.label ?? LABELS.SAFE; // heuristic says "no match" → assume SAFE
  if (h) heuristicHits++;
  r.pred = pred;
  r.heuristicHit = !!h;
  matrix[r.truth][pred] = (matrix[r.truth][pred] ?? 0) + 1;
}

function fmt(n) {
  return (n * 100).toFixed(2) + "%";
}

const perClass = {};
for (const c of ALL_LABELS) {
  const tp = matrix[c][c];
  const fp = ALL_LABELS.reduce((s, t) => s + (t === c ? 0 : matrix[t][c]), 0);
  const fn = ALL_LABELS.reduce((s, p) => s + (p === c ? 0 : matrix[c][p]), 0);
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  perClass[c] = { tp, fp, fn, precision, recall, f1 };
}
const correct = ALL_LABELS.reduce((s, c) => s + matrix[c][c], 0);
const accuracy = correct / rows.length;
const fpRate =
  rows.filter((r) => r.truth === "SAFE" && r.pred !== "SAFE").length /
  Math.max(1, rows.filter((r) => r.truth === "SAFE").length);

const report = {
  meta: { val: VAL, n: rows.length, mode: "heuristic_only" },
  accuracy,
  fpRate,
  heuristicHitRate: heuristicHits / rows.length,
  perClass,
  confusionMatrix: matrix,
};

mkdirSync(dirname(REPORT_OUT), { recursive: true });
writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2), "utf8");

console.log(`\n=== HEURISTIC-ONLY EVAL (n=${rows.length}) ===`);
console.log(`accuracy: ${fmt(accuracy)}`);
console.log(`fp rate (SAFE→block): ${fmt(fpRate)}`);
console.log(`heuristic hit rate: ${fmt(heuristicHits / rows.length)}`);
console.log("per-class:");
for (const c of ALL_LABELS) {
  const m = perClass[c];
  console.log(
    `  ${c.padEnd(13)} F1=${fmt(m.f1).padStart(8)} prec=${fmt(m.precision).padStart(8)} rec=${fmt(m.recall).padStart(8)} (tp=${m.tp} fp=${m.fp} fn=${m.fn})`,
  );
}
console.log(`\nreport saved: ${REPORT_OUT}`);
