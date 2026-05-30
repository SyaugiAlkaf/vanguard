// SPDX-License-Identifier: Apache-2.0
//
// Evaluate the 2-stage cascade on the 4-class val set (apples-to-apples with
// the flat detector's eval_report.json). LoRA-only (heuristic + mesh skipped)
// so we measure the cascade itself. Loads base+stage1 and base+stage2 as two
// model instances over the shared base.
//
// Usage:
//   node scripts/eval_cascade.mjs --base qwen3_1_7b \
//     --s1 artifacts/lora_cascade_s1/adapter.gguf \
//     --s2 artifacts/lora_cascade_s2/adapter.gguf \
//     --val data/sft/val.jsonl --report artifacts/training/eval_cascade.json

import { loadModel, unloadModel, close, QWEN3_600M_INST_Q4, QWEN3_1_7B_INST_Q4, QWEN3_4B_Q4_K_M, QWEN3_4B_INST_Q4_K_M } from "@qvac/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { classifyCascade } from "../src/cascade.mjs";
import { ALL_LABELS } from "../src/labels.mjs";

const BASES = {
  qwen3_600m: QWEN3_600M_INST_Q4,
  qwen3_1_7b: QWEN3_1_7B_INST_Q4,
  qwen3_4b: QWEN3_4B_Q4_K_M,
  qwen3_4b_inst: QWEN3_4B_INST_Q4_K_M,
};

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const k = args[i].slice(2);
      out[k] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const VAL = argv.val ?? "data/sft/val.jsonl";
const S1 = argv.s1;
const S2 = argv.s2;
const REPORT_OUT = argv.report ?? "artifacts/training/eval_cascade.json";
const MAX = argv.max ? Number(argv.max) : Infinity;
const BASE = BASES[(argv.base ?? "qwen3_1_7b").toString()];
if (!BASE) throw new Error(`Unknown --base. Known: ${Object.keys(BASES).join(", ")}`);
if (!S1 || !S2) throw new Error("--s1 and --s2 adapter paths required");

async function loadVal(path) {
  const rows = [];
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const msgs = JSON.parse(line).messages;
    const user = msgs.find((m) => m.role === "user")?.content ?? "";
    const truth = (msgs.find((m) => m.role === "assistant")?.content ?? "").trim().toUpperCase();
    if (user && truth) rows.push({ prompt: user, truth });
  }
  return rows;
}

function emptyMatrix() {
  const m = {};
  for (const t of ALL_LABELS) { m[t] = {}; for (const p of ALL_LABELS) m[t][p] = 0; }
  return m;
}

function summarize(matrix, rows, latencies) {
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
  const total = rows.length;
  const blockedTrue = rows.filter((r) => r.truth !== "SAFE").length;
  const blockedPred = rows.filter((r) => r.pred !== "SAFE").length;
  const blockedCorrect = rows.filter((r) => r.truth !== "SAFE" && r.pred !== "SAFE").length;
  const blockedPrecision = blockedPred ? blockedCorrect / blockedPred : 0;
  const blockedRecall = blockedTrue ? blockedCorrect / blockedTrue : 0;
  const blockedF1 = blockedPrecision + blockedRecall ? (2 * blockedPrecision * blockedRecall) / (blockedPrecision + blockedRecall) : 0;
  const falsePositiveRate = rows.filter((r) => r.truth === "SAFE" && r.pred !== "SAFE").length / Math.max(1, rows.filter((r) => r.truth === "SAFE").length);
  latencies.sort((a, b) => a - b);
  return {
    accuracy: total ? correct / total : 0,
    perClass, confusionMatrix: matrix,
    binary: { blockedPrecision, blockedRecall, blockedF1, falsePositiveRate },
    latencyMs: { mean: latencies.reduce((s, x) => s + x, 0) / Math.max(1, latencies.length), p50: latencies[Math.floor(latencies.length * 0.5)] ?? 0, p95: latencies[Math.floor(latencies.length * 0.95)] ?? 0 },
    n: total,
  };
}

async function main() {
  const rows = await loadVal(resolve(VAL));
  console.log(`[cascade-eval] ${rows.length} val rows; base+s1 and base+s2 loading...`);
  const m1 = await loadModel({ modelSrc: BASE, modelType: "llm", modelConfig: { lora: resolve(S1) } });
  const m2 = await loadModel({ modelSrc: BASE, modelType: "llm", modelConfig: { lora: resolve(S2) } });
  console.log("[cascade-eval] both stages loaded");

  const matrix = emptyMatrix();
  const latencies = [];
  const limit = Math.min(rows.length, MAX);
  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    let pred;
    try {
      const v = await classifyCascade({ stage1ModelId: m1, stage2ModelId: m2, prompt: r.prompt, skipHeuristics: true });
      pred = v.label;
      latencies.push(v.latencyMs);
    } catch (e) {
      pred = "SAFE";
      console.error(`\n[cascade-eval] row ${i} error: ${e.message}`);
    }
    r.pred = pred;
    matrix[r.truth][pred] = (matrix[r.truth][pred] ?? 0) + 1;
    if (i % 25 === 0 || i === limit - 1) {
      const corr = ALL_LABELS.reduce((s, c) => s + matrix[c][c], 0);
      process.stdout.write(`\r[cascade-eval] ${i + 1}/${limit} acc=${((corr / (i + 1)) * 100).toFixed(1)}%   `);
    }
  }
  console.log();

  const report = summarize(matrix, rows.slice(0, limit), latencies);
  report.meta = { timestamp: new Date().toISOString(), valPath: resolve(VAL), s1: resolve(S1), s2: resolve(S2), base: (argv.base ?? "qwen3_1_7b").toString(), kind: "cascade" };
  await mkdir(dirname(REPORT_OUT), { recursive: true });
  await writeFile(REPORT_OUT, JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== CASCADE EVAL ===");
  console.log(`accuracy: ${(report.accuracy * 100).toFixed(2)}%`);
  console.log(`binary blocked F1: ${(report.binary.blockedF1 * 100).toFixed(2)}%  precision: ${(report.binary.blockedPrecision * 100).toFixed(2)}%  recall: ${(report.binary.blockedRecall * 100).toFixed(2)}%`);
  console.log(`false-positive rate (SAFE->block): ${(report.binary.falsePositiveRate * 100).toFixed(2)}%`);
  for (const c of ALL_LABELS) {
    const m = report.perClass[c];
    console.log(`  ${c.padEnd(12)} F1=${(m.f1 * 100).toFixed(2)}% P=${(m.precision * 100).toFixed(2)}% R=${(m.recall * 100).toFixed(2)}%`);
  }
  console.log(`latency ms — mean=${report.latencyMs.mean.toFixed(0)} p50=${report.latencyMs.p50.toFixed(0)} p95=${report.latencyMs.p95.toFixed(0)}`);
  console.log(`report: ${resolve(REPORT_OUT)}`);

  await unloadModel({ modelId: m1 });
  await unloadModel({ modelId: m2 });
  await close();
}

main().catch((e) => { console.error(e); process.exit(1); });
