#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Populates a local SignatureStore from data/mesh_seed.jsonl. Run once
// per device before serving production traffic. After seeding, layer 2
// of the classifier catches canonical attacks in <10ms via SHA-256
// lookup, before layer 3 (LoRA) runs.
//
// usage:
//   node scripts/seed_mesh.mjs                            # default storage = .vanguard-mesh
//   node scripts/seed_mesh.mjs --storage /custom/path
//   node scripts/seed_mesh.mjs --device my-laptop
//   node scripts/seed_mesh.mjs --dry-run                  # show counts, no writes

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SignatureStore } from "../src/mesh/store.mjs";
import { canonicalize } from "../src/mesh/signatures.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const DEFAULT_SEED = resolve(ROOT, "data/mesh_seed.jsonl");

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

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const storage = argv.storage ?? "./.vanguard-mesh";
  const deviceId = argv.device ?? "seed-installer";
  const seedPath = argv.seed ?? DEFAULT_SEED;
  const dryRun = argv["dry-run"] === "true";

  if (!existsSync(seedPath)) {
    process.stderr.write(
      `error: seed file not found at ${seedPath}\n` +
        `hint: run \`node scripts/build_mesh_seed.mjs\` first to generate it.\n`,
    );
    process.exit(2);
  }

  const text = readFileSync(seedPath, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }

  process.stdout.write(`[seed] loaded ${rows.length} signatures from ${seedPath}\n`);
  process.stdout.write(`[seed] target storage: ${storage}\n`);
  process.stdout.write(`[seed] device id: ${deviceId}\n`);

  if (dryRun) {
    const byLabel = {};
    for (const r of rows) byLabel[r.label] = (byLabel[r.label] ?? 0) + 1;
    process.stdout.write(`[seed] dry-run; label distribution: ${JSON.stringify(byLabel)}\n`);
    process.exit(0);
  }

  const store = new SignatureStore(storage);
  await store.open();
  const ts = Date.now();
  let added = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = await store.get(r.sig);
    if (existing) {
      skipped++;
      continue;
    }
    await store.put({
      v: 1,
      sig: r.sig,
      label: r.label,
      transforms: r.vector ? [r.vector] : [],
      deviceId,
      ts,
      promptLen: r.promptLen,
    });
    added++;
  }
  const total = await store.count();
  process.stdout.write(`[seed] added ${added} new signatures (${skipped} already present)\n`);
  process.stdout.write(`[seed] store total: ${total}\n`);
  await store.close();
}

main().catch((e) => {
  console.error("[seed] error:", e);
  process.exit(1);
});
