#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Jury-legible presenter for the REAL cross-device propagation proof. It spawns
// scripts/mesh_p2p_proof.mjs unchanged (two independent hyperdht nodes, real
// Noise-encrypted stream, writes artifacts/mesh/p2p_proof.jsonl) and narrates
// that script's own live event stream one beat at a time. Every number shown
// (link ms, replication ms, signature hash, peer keys) is read verbatim from
// the real run — this layer only paces the readout so a human can follow it.
//
//   node scripts/mesh_proof_demo.mjs            # narrated, paced for video
//   node scripts/mesh_proof_demo.mjs --raw      # passthrough the real JSONL
//
// Reproduce without the narration: node scripts/mesh_p2p_proof.mjs

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL = resolve(ROOT, "scripts/mesh_p2p_proof.mjs");
const RAW = process.argv.includes("--raw");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[38;5;203m", green: "\x1b[38;5;78m", gold: "\x1b[38;5;179m",
  cyan: "\x1b[38;5;80m", gray: "\x1b[38;5;245m", white: "\x1b[38;5;255m",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const beat = (label, color, text) =>
  console.log(`   ${color}${C.bold}${label.padEnd(10)}${C.reset}${color}${text}${C.reset}`);

async function narrate(events) {
  const by = (name) => events.find((e) => e.event === name) ?? {};
  const peers = events.filter((e) => e.event === "peer_connected");
  const link = by("peers_established");
  const pre = by("pre_check_B");
  const pub = by("signature_published");
  const rep = by("signature_replicated");
  const post = by("post_check_B");
  const result = by("result");

  console.log(`${C.gold}${C.bold}\n  VANGUARD · cross-device immunity — LIVE 2-node proof${C.reset}`);
  console.log(`${C.dim}  real hyperdht · Noise-encrypted · no server, no cloud · written to artifacts/mesh/p2p_proof.jsonl${C.reset}\n`);
  await sleep(900);

  beat("PAIR", C.cyan, "two independent nodes — distinct keypairs, distinct stores");
  await sleep(700);
  console.log(`   ${C.dim}A = clinic-laptop   ·   B = home-tablet${C.reset}`);
  await sleep(900);
  if (peers.length >= 2) {
    beat("LINK", C.cyan, `paired over a real Noise stream in ${link.linkMs ?? "?"}ms — encrypted: ${link.encrypted === true}`);
    await sleep(1100);
  }

  beat("B BEFORE", C.gray, `B checks the attack → ${pre.match ?? "?"}`);
  console.log(`   ${C.dim}B has never seen this attack — with no signature it would fall through to the slow LoRA${C.reset}`);
  await sleep(1500);

  beat("A LEARNS", C.gold, `A stores + publishes signature ${(pub.sig ?? "").slice(0, 14)} (${pub.label ?? "?"})`);
  await sleep(1200);
  beat("RELAY", C.cyan, `B receives it peer-to-peer from ${rep.fromDevice ?? "A"} — no broker in between`);
  await sleep(1200);
  beat("B AFTER", C.green, `B re-checks → ${post.blocked ? "BLOCKED" : "?"} · replicated in ${post.replicationMs ?? "?"}ms`);
  await sleep(1400);

  const ok = result.ok === true;
  console.log(`\n${ok ? C.green : C.red}${C.bold}  ${ok ? "✓ PROVEN" : "✗ FAILED"}${C.reset}`);
  console.log(`${C.gray}  ${result.summary ?? "(no summary)"}${C.reset}`);
  console.log(`${C.dim}  Reproduce: node scripts/mesh_p2p_proof.mjs  ·  evidence: artifacts/mesh/p2p_proof.jsonl${C.reset}\n`);
}

async function main() {
  if (!RAW) {
    console.log(`${C.dim}  starting real 2-node hyperdht proof…${C.reset}`);
  }
  const child = spawn(process.execPath, [REAL], { cwd: ROOT });
  const events = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const s = line.trim();
    if (!s) return;
    if (RAW) { console.log(s); return; }
    try { events.push(JSON.parse(s)); } catch { /* non-JSON child noise */ }
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });

  const code = await new Promise((res) => child.on("close", res));
  if (RAW) process.exit(code ?? 0);

  if (code !== 0) {
    console.error(`${C.red}  proof run failed (exit ${code}).${C.reset}`);
    const errEv = events.find((e) => e.event === "error");
    if (errEv) console.error(`${C.red}  ${errEv.error}${C.reset}`);
    else if (stderr.trim()) console.error(C.dim + stderr.trim().split("\n").slice(-4).join("\n") + C.reset);
    process.exit(code ?? 1);
  }
  await narrate(events);
}

main().catch((e) => { console.error(e); process.exit(1); });
