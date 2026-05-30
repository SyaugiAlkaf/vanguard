// SPDX-License-Identifier: Apache-2.0
// Extend data/mesh_seed.jsonl with canonical signatures of real attacks that
// the heuristic STILL misses, so the ~10ms mesh layer catches them before the
// LoRA runs. Strengthens both the block rate and the P2P narrative (the mesh
// carries real public-corpus attack intel, not just demo seeds).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { signatureHash, canonicalize } from "../src/mesh/signatures.mjs";
import { heuristicClassify } from "../src/heuristics.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SEED = resolve(ROOT, "data/mesh_seed.jsonl");
const rows = (p) => readFileSync(resolve(ROOT, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const existing = rows("data/mesh_seed.jsonl");
const haveSig = new Set(existing.map((r) => r.sig));
console.log(`existing seed: ${existing.length} signatures`);

const exfil = rows("data/raw/exfil_external.jsonl");
const jb = rows("data/raw/jailbreak_external.jsonl");

// Keep only attacks the current heuristic does NOT already catch (mesh adds
// value exactly where the regex layer misses). Cap EXFIL to a curated sample
// so the seed stays a reasonable size; take all missed JB (small set).
function pick(set, label, source, cap) {
  const out = [];
  const seenSig = new Set();
  for (const r of set) {
    if (heuristicClassify(r.prompt)) continue; // already caught by regex
    const canon = canonicalize(r.prompt);
    if (canon.length < 12) continue; // skip degenerate
    const sig = signatureHash(r.prompt);
    if (haveSig.has(sig) || seenSig.has(sig)) continue;
    seenSig.add(sig);
    out.push({
      sig, label, source, license: "MIT",
      vector: label === "EXFILTRATION" ? "system_prompt_leak" : "jailbreak",
      promptLen: r.prompt.length,
      promptPreview: r.prompt.slice(0, 80),
    });
    if (out.length >= cap) break;
  }
  return out;
}

const newExfil = pick(exfil, "EXFILTRATION", "ethz-spylab/ctf-satml24", 300);
const newJb = pick(jb, "JAILBREAK", "TrustAIRLab/in-the-wild-jailbreak-prompts", 250);
console.log(`new signatures: EXFIL=${newExfil.length} JB=${newJb.length}`);

const merged = [...existing, ...newExfil, ...newJb];
writeFileSync(SEED, merged.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`mesh_seed.jsonl: ${existing.length} -> ${merged.length} signatures`);
