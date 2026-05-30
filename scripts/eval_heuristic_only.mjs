#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Unbiased heuristic-only evaluation. Runs heuristicClassify against a
// held-out JSONL of {prompt, label} or SFT-format rows. Reports per-class
// precision/recall/F1 + binary blocked-F1 + FP rate + confusion matrix.
//
// Heuristics in src/heuristics.mjs were designed against the clinical demo
// scenarios. val.jsonl was NOT inspected during heuristic design — every
// row is unseen test data for the regex layer.
//
// usage:
//   node scripts/eval_heuristic_only.mjs                              # default val.jsonl
//   node scripts/eval_heuristic_only.mjs --val data/sft/val_v3.jsonl
//   node scripts/eval_heuristic_only.mjs --out artifacts/training/heuristic_only_eval.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { heuristicClassify, heuristicSummary } from "../src/heuristics.mjs";
import { LABELS, ALL_LABELS } from "../src/labels.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

function loadVal(path) {
  const text = readFileSync(path, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      let prompt, label;
      if (Array.isArray(obj.messages)) {
        prompt = obj.messages.find((m) => m.role === "user")?.content ?? "";
        label = (obj.messages.find((m) => m.role === "assistant")?.content ?? "").trim().toUpperCase();
      } else {
        prompt = obj.prompt ?? obj.text ?? "";
        label = String(obj.label ?? obj.class ?? "").trim().toUpperCase();
      }
      if (prompt && label) rows.push({ prompt, label });
    } catch {
      /* skip */
    }
  }
  return rows;
}

function metrics(predictions) {
  const conf = {};
  for (const a of ALL_LABELS) {
    conf[a] = {};
    for (const b of ALL_LABELS) conf[a][b] = 0;
  }
  for (const { truth, pred } of predictions) {
    conf[truth][pred] = (conf[truth][pred] ?? 0) + 1;
  }
  const perClass = {};
  for (const lbl of ALL_LABELS) {
    const tp = conf[lbl][lbl];
    let fp = 0, fn = 0;
    for (const other of ALL_LABELS) {
      if (other === lbl) continue;
      fn += conf[lbl][other];
      fp += conf[other][lbl];
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[lbl] = { tp, fp, fn, precision, recall, f1 };
  }

  // Binary block-or-allow: positive = any attack label, negative = SAFE
  let binTP = 0, binFP = 0, binFN = 0, binTN = 0;
  for (const { truth, pred } of predictions) {
    const truthAttack = truth !== LABELS.SAFE;
    const predAttack = pred !== LABELS.SAFE;
    if (truthAttack && predAttack) binTP++;
    else if (!truthAttack && predAttack) binFP++;
    else if (truthAttack && !predAttack) binFN++;
    else binTN++;
  }
  const binPrecision = binTP + binFP === 0 ? 0 : binTP / (binTP + binFP);
  const binRecall = binTP + binFN === 0 ? 0 : binTP / (binTP + binFN);
  const binF1 = binPrecision + binRecall === 0 ? 0 : (2 * binPrecision * binRecall) / (binPrecision + binRecall);
  const safeRows = predictions.filter((p) => p.truth === LABELS.SAFE).length;
  const fpRate = safeRows === 0 ? 0 : binFP / safeRows;

  const accuracy = predictions.filter((p) => p.pred === p.truth).length / predictions.length;

  return {
    n: predictions.length,
    accuracy,
    perClass,
    confusion: conf,
    binary: {
      tp: binTP,
      fp: binFP,
      fn: binFN,
      tn: binTN,
      precision: binPrecision,
      recall: binRecall,
      f1: binF1,
      fpRate,
    },
  };
}

function main() {
  const argv = parseArgs(process.argv.slice(2));
  const valPath = resolve(ROOT, argv.val ?? "data/sft/val.jsonl");
  const outPath = resolve(ROOT, argv.out ?? "artifacts/training/heuristic_only_eval.json");

  process.stdout.write(`[heuristic-eval] reading ${valPath}\n`);
  const rows = loadVal(valPath);
  process.stdout.write(`[heuristic-eval] rows: ${rows.length}\n`);
  process.stdout.write(`[heuristic-eval] pattern counts: ${JSON.stringify(heuristicSummary())}\n`);

  const predictions = [];
  let catchCount = 0;
  let falloffCount = 0;
  for (const r of rows) {
    const h = heuristicClassify(r.prompt);
    const pred = h?.label ?? LABELS.SAFE;
    predictions.push({ truth: r.label, pred, heuristicHit: !!h });
    if (h) catchCount++;
    else falloffCount++;
  }
  process.stdout.write(
    `[heuristic-eval] heuristic catch: ${catchCount} / fall-through to LoRA: ${falloffCount}\n`,
  );

  const m = metrics(predictions);

  // Heuristic-coverage rate: of attacks in the truth, how many did heuristic catch (correctly OR incorrectly)?
  const attackRows = predictions.filter((p) => p.truth !== LABELS.SAFE);
  const attackHits = attackRows.filter((p) => p.heuristicHit).length;
  const safeRows = predictions.filter((p) => p.truth === LABELS.SAFE);
  const safeWronglyHit = safeRows.filter((p) => p.heuristicHit).length;

  const report = {
    generated_at: new Date().toISOString(),
    val_path: argv.val ?? "data/sft/val.jsonl",
    pattern_counts: heuristicSummary(),
    coverage: {
      total_rows: rows.length,
      heuristic_hits: catchCount,
      heuristic_misses_fallthrough_to_lora: falloffCount,
      attack_rows: attackRows.length,
      attack_rows_caught_by_heuristic: attackHits,
      attack_catch_rate: attackRows.length === 0 ? 0 : attackHits / attackRows.length,
      safe_rows: safeRows.length,
      safe_rows_wrongly_flagged: safeWronglyHit,
      heuristic_false_positive_rate: safeRows.length === 0 ? 0 : safeWronglyHit / safeRows.length,
    },
    metrics: m,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`\n=== Heuristic-only eval (UNBIASED — val.jsonl held out from heuristic design) ===\n`);
  process.stdout.write(`accuracy:           ${(m.accuracy * 100).toFixed(2)}%\n`);
  process.stdout.write(`binary blocked F1:  ${(m.binary.f1 * 100).toFixed(2)}%\n`);
  process.stdout.write(`binary precision:   ${(m.binary.precision * 100).toFixed(2)}%\n`);
  process.stdout.write(`binary recall:      ${(m.binary.recall * 100).toFixed(2)}%\n`);
  process.stdout.write(`binary FP rate:     ${(m.binary.fpRate * 100).toFixed(2)}%\n`);
  process.stdout.write(`SAFE F1:            ${(m.perClass.SAFE.f1 * 100).toFixed(2)}%\n`);
  process.stdout.write(`INJECTION F1:       ${(m.perClass.INJECTION.f1 * 100).toFixed(2)}%\n`);
  process.stdout.write(`JAILBREAK F1:       ${(m.perClass.JAILBREAK.f1 * 100).toFixed(2)}%\n`);
  process.stdout.write(`EXFILTRATION F1:    ${(m.perClass.EXFILTRATION.f1 * 100).toFixed(2)}%\n`);
  process.stdout.write(`heuristic catch:    ${attackHits}/${attackRows.length} attacks (${(report.coverage.attack_catch_rate * 100).toFixed(2)}%)\n`);
  process.stdout.write(`heuristic FP:       ${safeWronglyHit}/${safeRows.length} safe rows wrongly flagged (${(report.coverage.heuristic_false_positive_rate * 100).toFixed(2)}%)\n`);
  process.stdout.write(`\nwrote ${outPath}\n`);
}

main();
