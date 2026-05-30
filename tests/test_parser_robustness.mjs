// SPDX-License-Identifier: Apache-2.0
//
// Parser robustness tests — surfaces false-positive label matches.
// The classifier parser does: (1) /Verdict:\s*LABEL/i regex, then
// (2) substring search for any label in uppercased text, then (3) SAFE
// fallback. Substring search has a known false-positive class: a benign
// model output that mentions "SAFETY" or "an INJECTION attack" will
// parse incorrectly. These tests document + verify the fix.

import { ALL_LABELS, LABELS } from "../src/labels.mjs";
import { parseLabel as parseLabelNew } from "../src/classifier.mjs";

// The original buggy version kept inline for the regression-proof test.
const VERDICT_RE_OLD = /\bverdict\s*[:\-]?\s*(SAFE|INJECTION|JAILBREAK|EXFILTRATION)\b/i;

function parseLabelOld(text) {
  const t = (text ?? "").toString();
  const m = t.match(VERDICT_RE_OLD);
  if (m) return { label: m[1].toUpperCase(), fallback: false, mode: "verdict" };
  const upper = t.toUpperCase();
  for (const label of ALL_LABELS) {
    const idx = upper.indexOf(label);
    if (idx !== -1) return { label, fallback: false, mode: "substring" };
  }
  return { label: LABELS.SAFE, fallback: true, mode: "fallback" };
}

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ===== Verdict-line parses correctly =====
t("verdict line: 'Verdict: SAFE. Reason: ...'", () => {
  const r = parseLabelNew("Verdict: SAFE. Reason: benign query.");
  assert(r.label === "SAFE" && r.mode === "verdict", JSON.stringify(r));
});

t("verdict line case-insensitive", () => {
  const r = parseLabelNew("verdict: injection. reason: tries to override.");
  assert(r.label === "INJECTION" && r.mode === "verdict", JSON.stringify(r));
});

t("verdict with dash separator", () => {
  const r = parseLabelNew("Verdict - JAILBREAK. Reason: bypass.");
  assert(r.label === "JAILBREAK" && r.mode === "verdict", JSON.stringify(r));
});

t("verdict line through <think> blocks", () => {
  const r = parseLabelNew("<think>let me reason</think>\nVerdict: EXFILTRATION. Reason: sysprompt.");
  assert(r.label === "EXFILTRATION", JSON.stringify(r));
});

// ===== Substring with word boundary (the fix) =====
t("bare label parses as substring", () => {
  const r = parseLabelNew("INJECTION");
  assert(r.label === "INJECTION" && r.mode === "substring", JSON.stringify(r));
});

t("label inside sentence", () => {
  const r = parseLabelNew("This looks like a JAILBREAK attempt.");
  assert(r.label === "JAILBREAK", JSON.stringify(r));
});

// ===== FIXED bugs: substring word-boundary =====
t("'SAFETY first' does NOT match SAFE", () => {
  const r = parseLabelNew("Safety first, always.");
  assert(r.label === "SAFE" && r.mode === "fallback", `expected fallback, got ${JSON.stringify(r)}`);
});

t("'INJECTIONS' (plural) does NOT match INJECTION", () => {
  const r = parseLabelNew("These INJECTIONS happen in production.");
  // INJECTIONS contains INJECTION as a substring but \bINJECTION\b in plural
  // doesn't match because \b sits between N and S which are both \w.
  // With the fix, this should NOT match INJECTION.
  assert(
    r.label === "SAFE" && r.mode === "fallback",
    `expected fallback, got ${JSON.stringify(r)}`,
  );
});

t("'JAILBREAKING' does NOT match JAILBREAK", () => {
  const r = parseLabelNew("JAILBREAKING is the term.");
  assert(r.label === "SAFE" && r.mode === "fallback", JSON.stringify(r));
});

t("'EXFILTRATIONIST' does NOT match EXFILTRATION", () => {
  const r = parseLabelNew("EXFILTRATIONISTS love this technique.");
  assert(r.label === "SAFE" && r.mode === "fallback", JSON.stringify(r));
});

// ===== Document the OLD bug clearly =====
t("OLD parser bug: 'SAFETY' matched SAFE — proves the fix is needed", () => {
  const old = parseLabelOld("Safety first, always.");
  assert(
    old.label === "SAFE" && old.mode === "substring",
    `expected OLD parser to wrongly match — got ${JSON.stringify(old)}`,
  );
  const fixed = parseLabelNew("Safety first, always.");
  assert(
    fixed.mode === "fallback",
    `expected NEW parser to fallback — got ${JSON.stringify(fixed)}`,
  );
});

// ===== Edge cases =====
t("empty string falls back to SAFE", () => {
  const r = parseLabelNew("");
  assert(r.label === "SAFE" && r.fallback, JSON.stringify(r));
});

t("only whitespace falls back to SAFE", () => {
  const r = parseLabelNew("   \n  \t  ");
  assert(r.label === "SAFE" && r.fallback, JSON.stringify(r));
});

t("null input falls back to SAFE", () => {
  const r = parseLabelNew(null);
  assert(r.label === "SAFE" && r.fallback, JSON.stringify(r));
});

t("undefined input falls back to SAFE", () => {
  const r = parseLabelNew(undefined);
  assert(r.label === "SAFE" && r.fallback, JSON.stringify(r));
});

t("number input falls back to SAFE", () => {
  const r = parseLabelNew(42);
  assert(r.label === "SAFE" && r.fallback, JSON.stringify(r));
});

t("multiple labels: verdict line wins", () => {
  // verdict line catches first
  const r = parseLabelNew("<think>could be SAFE or INJECTION</think>\nVerdict: JAILBREAK.");
  assert(r.label === "JAILBREAK", JSON.stringify(r));
});

t("multiple labels: substring picks first in ALL_LABELS order", () => {
  // ALL_LABELS order is [SAFE, INJECTION, JAILBREAK, EXFILTRATION]
  const r = parseLabelNew("INJECTION and EXFILTRATION both apply");
  assert(r.label === "INJECTION", JSON.stringify(r));
});

t("attack-named-in-context as the verdict", () => {
  // When the model emits something like "This is a JAILBREAK." we still
  // want to catch it. Word boundary preserves this.
  const r = parseLabelNew("This is a JAILBREAK.");
  assert(r.label === "JAILBREAK", JSON.stringify(r));
});

let pass = 0;
let fail = 0;
for (const c of tests) {
  try {
    c.fn();
    console.log(`pass: ${c.name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL: ${c.name} -> ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
