#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Build a NOVEL held-out test set: rows from data/raw/ that are NOT in
// data/sft/train_v2.jsonl, val_v2.jsonl, train_v3.jsonl, or val_v3.jsonl.
// These rows were cut by the PER_CLASS rebalance — the LoRA never trained
// on them, the prepared dataset never included them, and the heuristic
// patterns were never tuned to catch them.
//
// Output: data/holdout_novel.jsonl

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const RAW_FILES = [
  "data/raw/attack.jsonl",
  "data/raw/benign.jsonl",
  "data/raw/exfil_curated.jsonl",
  "data/raw/safe_hardneg.jsonl",
];

// The shipping production adapter (artifacts/lora/adapter.gguf) is the
// v2-trained checkpoint. v1's train.jsonl is a HISTORICAL artifact and is
// NOT part of the current shipping pipeline. We want held-out data the
// v2 adapter and the heuristic patterns never saw, so we exclude v1.
const TRAINED_FILES = [
  "data/sft/train_v2.jsonl",
  "data/sft/val_v2.jsonl",
  "data/sft/train_v3.jsonl",
  "data/sft/val_v3.jsonl",
];

const MAX_PROMPT_CHARS = 1000;

function readJsonlPromptsAndLabels(path) {
  try {
    const text = readFileSync(resolve(ROOT, path), "utf8");
    const out = [];
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
        if (prompt) out.push({ prompt, label, source: obj.source ?? "?" });
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function truncate(s) {
  if (s.length <= MAX_PROMPT_CHARS) return s;
  return s.slice(0, MAX_PROMPT_CHARS) + " [truncated]";
}

function main() {
  // Build set of prompts that were in any trained dataset.
  const seenPrompts = new Set();
  for (const f of TRAINED_FILES) {
    const rows = readJsonlPromptsAndLabels(f);
    for (const r of rows) {
      const t = truncate(r.prompt);
      seenPrompts.add(`${r.label}::${t}`);
    }
  }
  process.stdout.write(`[holdout] trained-dataset prompts indexed: ${seenPrompts.size}\n`);

  // Now find raw rows that are NOT in seenPrompts.
  const holdout = [];
  const stats = { total_raw: 0, in_train: 0, kept: 0 };
  const labelCounts = {};
  const sourceCounts = {};

  for (const f of RAW_FILES) {
    const rows = readJsonlPromptsAndLabels(f);
    for (const r of rows) {
      stats.total_raw++;
      const t = truncate(r.prompt);
      const key = `${r.label}::${t}`;
      if (seenPrompts.has(key)) {
        stats.in_train++;
        continue;
      }
      if (!r.prompt || !r.label) continue;
      // Re-label gandalf_summarization the same way prepare_v2 does so the
      // holdout label is consistent with the model's training distribution.
      let label = r.label;
      if (r.source === "Lakera/gandalf_summarization" && label === "EXFILTRATION") {
        label = "INJECTION";
      }
      const prompt = truncate(r.prompt.trim());
      const k2 = `${label}::${prompt}`;
      if (seenPrompts.has(k2)) {
        stats.in_train++;
        continue;
      }
      holdout.push({ prompt, label, source: r.source });
      labelCounts[label] = (labelCounts[label] ?? 0) + 1;
      sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
      stats.kept++;
    }
  }

  const out = resolve(ROOT, "data/holdout_novel.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    holdout.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );

  process.stdout.write(`[holdout] raw total: ${stats.total_raw}\n`);
  process.stdout.write(`[holdout] in train: ${stats.in_train}\n`);
  process.stdout.write(`[holdout] kept (novel): ${stats.kept}\n`);
  process.stdout.write(`[holdout] by label: ${JSON.stringify(labelCounts)}\n`);
  process.stdout.write(`[holdout] by source:\n`);
  for (const [src, n] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${src}: ${n}\n`);
  }
  process.stdout.write(`\nwrote ${out}\n`);
}

main();
