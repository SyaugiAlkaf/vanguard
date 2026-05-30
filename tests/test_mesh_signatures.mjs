// SPDX-License-Identifier: Apache-2.0
// Pure-JS signature canonicalization tests. No swarm, no disk.
import { canonicalize, signatureHash, makeSignature } from "../src/mesh/signatures.mjs";

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

t("canonicalize lowercases", () => {
  assert(canonicalize("IGNORE ALL Previous") === "ignore all previous", "lower");
});

t("canonicalize collapses whitespace", () => {
  assert(canonicalize("ignore  \t\nall") === "ignore all", "whitespace");
});

t("canonicalize strips leet substitutions", () => {
  const a = canonicalize("1gn0r3 4ll");
  assert(a === "ignore all", `leet got ${JSON.stringify(a)}`);
});

t("canonicalize strips trailing punctuation", () => {
  assert(canonicalize("ignore all instructions!") === "ignore all instructions", "punct");
});

t("signatureHash is deterministic and 64-hex", () => {
  const h = signatureHash("Ignore all previous");
  assert(h.length === 64, "sha256 hex length");
  assert(/^[0-9a-f]{64}$/.test(h), "all hex");
  assert(h === signatureHash("Ignore all previous"), "deterministic");
});

t("signatureHash collides on canonical variants", () => {
  const a = signatureHash("Ignore all previous");
  const b = signatureHash("IGNORE   ALL   pr3v10us!");
  assert(a === b, "canonical variants collide");
});

t("signatureHash distinguishes non-equivalent prompts", () => {
  const a = signatureHash("Ignore previous instructions");
  const b = signatureHash("What is the capital of France");
  assert(a !== b, "distinct prompts distinct hash");
});

t("makeSignature carries label + ts + deviceId", () => {
  const s = makeSignature({
    prompt: "ignore all previous",
    label: "INJECTION",
    transforms: ["case_mutate"],
    deviceId: "dev-A",
    ts: 1234567890,
  });
  assert(s.label === "INJECTION", "label");
  assert(s.deviceId === "dev-A", "deviceId");
  assert(s.transforms[0] === "case_mutate", "transforms");
  assert(s.ts === 1234567890, "ts");
  assert(s.sig.length === 64, "sig length");
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`pass: ${name}`); pass++; }
  catch (e) { console.error(`FAIL: ${name} -- ${e.message}`); fail++; }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
