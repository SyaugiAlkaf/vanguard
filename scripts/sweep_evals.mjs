// SPDX-License-Identifier: Apache-2.0
import {
  loadModel,
  unloadModel,
  close,
  QWEN3_1_7B_INST_Q4,
} from "@qvac/sdk";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../src/classifier.mjs";
import { ALL_LABELS } from "../src/labels.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const CKPT_DIR = process.argv[2] ?? resolve(ROOT, "artifacts/training/checkpoints");
const VAL = process.argv[3] ?? resolve(ROOT, "data/sft/val.jsonl");
const N = Number(process.argv[4] ?? 40);
const REPORT = resolve(ROOT, "artifacts/training/sweep_report.json");

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

function metrics(matrix, rows) {
  const out = {};
  for (const c of ALL_LABELS) {
    const tp = matrix[c][c];
    const fp = ALL_LABELS.reduce((s, t) => s + (t === c ? 0 : matrix[t][c]), 0);
    const fn = ALL_LABELS.reduce((s, p) => s + (p === c ? 0 : matrix[c][p]), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    out[c] = { f1, precision, recall };
  }
  const correct = ALL_LABELS.reduce((s, c) => s + matrix[c][c], 0);
  const accuracy = rows.length ? correct / rows.length : 0;
  const fpRate =
    rows.filter((r) => r.truth === "SAFE" && r.pred !== "SAFE").length /
    Math.max(1, rows.filter((r) => r.truth === "SAFE").length);
  const minF1 = Math.min(...ALL_LABELS.map((c) => out[c].f1));
  return { accuracy, fpRate, minF1, perClass: out };
}

async function evalOne(modelId, rows) {
  const matrix = Object.fromEntries(
    ALL_LABELS.map((t) => [t, Object.fromEntries(ALL_LABELS.map((p) => [p, 0]))]),
  );
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let pred = "SAFE";
    try {
      const v = await classify({ modelId, prompt: r.prompt, maxTokens: 60 });
      pred = v.label;
    } catch (_) {
      /* leave as SAFE fallback */
    }
    r.pred = pred;
    matrix[r.truth][pred] = (matrix[r.truth][pred] ?? 0) + 1;
  }
  return metrics(matrix, rows);
}

const ckpts = readdirSync(CKPT_DIR)
  .filter((n) => n.startsWith("checkpoint_step_"))
  .sort();
console.log(`[sweep] checkpoints: ${ckpts.join(", ")}`);

const valRows = loadVal(VAL).slice(0, N);
console.log(`[sweep] eval rows: ${valRows.length}`);

const results = [];

for (const ck of ckpts) {
  const adapter = join(CKPT_DIR, ck, "model.gguf");
  console.log(`\n[sweep] === ${ck} ===`);
  const t0 = performance.now();
  const id = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: "llm",
    modelConfig: { lora: adapter },
    onProgress: () => {},
  });
  const m = await evalOne(id, valRows.map((r) => ({ ...r })));
  const dt = (performance.now() - t0) / 1000;
  console.log(
    `[sweep] ${ck}: acc=${(m.accuracy * 100).toFixed(1)}% minF1=${(m.minF1 * 100).toFixed(1)}% fp=${(m.fpRate * 100).toFixed(1)}%`,
  );
  for (const c of ALL_LABELS) {
    console.log(`         ${c.padEnd(12)} F1=${(m.perClass[c].f1 * 100).toFixed(1)}%`);
  }
  console.log(`[sweep] ${ck}: ${dt.toFixed(0)}s`);
  results.push({ ckpt: ck, ...m, secs: dt });
  await unloadModel({ modelId: id });
}

results.sort((a, b) => b.minF1 - a.minF1 || b.accuracy - a.accuracy);
writeFileSync(REPORT, JSON.stringify(results, null, 2), "utf8");
console.log(`\n[sweep] best by min-class-F1: ${results[0].ckpt} minF1=${(results[0].minF1 * 100).toFixed(1)}% acc=${(results[0].accuracy * 100).toFixed(1)}%`);
console.log(`[sweep] saved: ${REPORT}`);

await close();
