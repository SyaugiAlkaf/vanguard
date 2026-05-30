#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Builds data/mesh_seed.jsonl — a curated set of canonical attack
// signatures that ship with the repo. Operators populate their local
// mesh store from this seed before running production, so layer 2
// (signature lookup) catches canonical attacks in <10ms before the
// LoRA layer runs.
//
// Composition (target ~180 signatures, stratified across the three
// attack classes; SAFE rows are explicitly NOT seeded — we never want
// to "remember" a SAFE prompt because the local SignatureStore is
// block-on-match):
//   - all 108 rows from data/raw/exfil_curated.jsonl
//   - 40 INJECTION rows from data/raw/attack.jsonl
//   - 20 JAILBREAK rows from data/raw/attack.jsonl
//   - 10 canonical Sari scenarios
//   - 10 hard Sari scenarios

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { signatureHash } from "../src/mesh/signatures.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const SEED_OUT = resolve(ROOT, "data/mesh_seed.jsonl");
const SOURCES = [
  { path: "data/raw/exfil_curated.jsonl", labels: ["EXFILTRATION"], take: Infinity, sourceTag: "exfil_curated" },
  { path: "data/raw/attack.jsonl", labels: ["INJECTION"], take: 40, sourceTag: "attack_injection" },
  { path: "data/raw/attack.jsonl", labels: ["JAILBREAK"], take: 20, sourceTag: "attack_jailbreak" },
  { path: "src/demo/medpsy/scenarios.jsonl", labels: ["INJECTION", "JAILBREAK", "EXFILTRATION"], take: Infinity, sourceTag: "sari_canonical" },
  { path: "src/demo/medpsy/scenarios_hard.jsonl", labels: ["INJECTION", "JAILBREAK", "EXFILTRATION"], take: Infinity, sourceTag: "sari_hard" },
];

function loadJsonl(path) {
  const text = readFileSync(resolve(ROOT, path), "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip malformed line */
    }
  }
  return rows;
}

function main() {
  const seen = new Set();
  const out = [];
  const stats = {};

  for (const src of SOURCES) {
    const rows = loadJsonl(src.path);
    let taken = 0;
    for (const r of rows) {
      if (taken >= src.take) break;
      if (!src.labels.includes(r.label)) continue;
      const prompt = r.prompt;
      if (!prompt || typeof prompt !== "string") continue;
      const sig = signatureHash(prompt);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({
        sig,
        label: r.label,
        source: r.source ?? src.sourceTag,
        license: r.license ?? "Apache-2.0",
        vector: r.vector ?? null,
        promptLen: prompt.length,
        promptPreview: prompt.slice(0, 80),
      });
      taken++;
    }
    stats[src.sourceTag] = (stats[src.sourceTag] ?? 0) + taken;
  }

  mkdirSync(dirname(SEED_OUT), { recursive: true });
  writeFileSync(
    SEED_OUT,
    out.map((s) => JSON.stringify(s)).join("\n") + "\n",
    "utf8",
  );

  process.stdout.write(`wrote ${out.length} signatures to ${SEED_OUT}\n`);
  for (const [tag, n] of Object.entries(stats)) {
    process.stdout.write(`  ${tag}: ${n}\n`);
  }
  const byLabel = {};
  for (const s of out) byLabel[s.label] = (byLabel[s.label] ?? 0) + 1;
  process.stdout.write(`label distribution: ${JSON.stringify(byLabel)}\n`);
}

main();
