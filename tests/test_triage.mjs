// SPDX-License-Identifier: Apache-2.0
//
// Red-flag triage tests. Pure regex, no model load.

import { triage, triageSummary } from "../src/triage.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ===== Cardiac =====
t("chest pain -> cardiac emergency", () => {
  const r = triage("I have sudden chest pain radiating down my arm.");
  assert(r !== null, "expected match, got null");
  assert(r.label === "cardiac emergency", `label=${r.label}`);
  assert(r.severity === "emergency", `severity=${r.severity}`);
  assert(typeof r.action === "string" && r.action.length > 0, "action missing");
  assert(typeof r.hit === "string" && r.hit.length > 0, "hit missing");
});

t("crushing pressure on my chest -> cardiac", () => {
  // Hits the 'chest pressure' branch of cardiac patterns.
  const r = triage("I feel crushing chest pressure right now.");
  assert(r !== null);
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("left arm tingling -> cardiac", () => {
  const r = triage("My left arm tingling started about an hour ago.");
  assert(r !== null);
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("my heart hurts -> cardiac", () => {
  const r = triage("my heart hurts and i feel woozy");
  assert(r !== null, "expected match, got null");
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("my heart aches -> cardiac", () => {
  const r = triage("my heart aches all morning");
  assert(r !== null);
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("heart attack -> cardiac", () => {
  const r = triage("i think im having a heart attack");
  assert(r !== null);
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("my heart ick -> cardiac (sloppy typo variant)", () => {
  const r = triage("my heart ick, i cant stand");
  assert(r !== null, "expected match for 'my heart ick'");
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("my heart feels off -> cardiac", () => {
  const r = triage("my heart feels off today");
  assert(r !== null);
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("my heart feels sakit -> cardiac (Indonesian)", () => {
  const r = triage("my heart feels sakit");
  assert(r !== null);
  assert(r.label === "cardiac emergency", `label=${r.label}`);
});

t("'my heart is broken after the breakup' -> null (emotional, not cardiac)", () => {
  const r = triage("my heart is broken after the breakup");
  assert(r === null, "expected null, got " + JSON.stringify(r));
});

t("'my heart sings when i see her' -> null", () => {
  const r = triage("my heart sings when i see her");
  assert(r === null, "expected null");
});

t("'heart rate is around 110 when standing' -> null (POTS context)", () => {
  const r = triage("heart rate is around 110 when standing");
  assert(r === null, "expected null, got " + JSON.stringify(r));
});

// ===== Stroke =====
t("sudden severe headache -> stroke", () => {
  const r = triage("A sudden severe headache hit me out of nowhere.");
  assert(r !== null);
  assert(r.label === "possible stroke", `label=${r.label}`);
});

t("thunderclap headache -> stroke", () => {
  const r = triage("This is a thunderclap headache I have never had before.");
  assert(r !== null);
  assert(r.label === "possible stroke", `label=${r.label}`);
});

t("worst headache of my life -> stroke", () => {
  const r = triage("This is the worst headache of my life.");
  assert(r !== null);
  assert(r.label === "possible stroke", `label=${r.label}`);
});

t("one-sided weakness -> stroke", () => {
  const r = triage("I noticed one-sided weakness in my arm and leg.");
  assert(r !== null);
  assert(r.label === "possible stroke", `label=${r.label}`);
});

t("facial droop -> stroke", () => {
  const r = triage("My partner says I have facial droop on the right side.");
  assert(r !== null);
  assert(r.label === "possible stroke", `label=${r.label}`);
});

// ===== Anaphylaxis =====
t("throat closing -> anaphylaxis", () => {
  const r = triage("It feels like my throat closing after eating shrimp.");
  assert(r !== null);
  assert(r.label === "anaphylaxis or severe allergic reaction", `label=${r.label}`);
});

t("anaphylaxis word -> anaphylaxis", () => {
  const r = triage("I am having anaphylaxis again.");
  assert(r !== null);
  assert(r.label === "anaphylaxis or severe allergic reaction", `label=${r.label}`);
});

// ===== Severe SOB =====
t("can't catch my breath -> severe SOB", () => {
  const r = triage("I can't catch my breath since this morning.");
  assert(r !== null);
  assert(r.label === "severe shortness of breath", `label=${r.label}`);
});

t("unable to speak in full sentences -> severe SOB", () => {
  const r = triage("I am unable to speak in full sentences when walking.");
  assert(r !== null);
  assert(r.label === "severe shortness of breath", `label=${r.label}`);
});

// ===== Suicidality =====
t("I want to kill myself -> suicidality", () => {
  const r = triage("I want to kill myself, I cannot do this anymore.");
  assert(r !== null);
  assert(r.label === "suicidality or self-harm", `label=${r.label}`);
});

// ===== Acute abdomen =====
t("rigid abdomen with fever -> acute abdomen", () => {
  const r = triage("I have a rigid abdomen with fever and vomiting.");
  assert(r !== null);
  assert(r.label === "acute abdomen", `label=${r.label}`);
});

// ===== Meningitis =====
t("stiff neck with fever -> meningitis", () => {
  const r = triage("I have a stiff neck with fever for two days.");
  assert(r !== null);
  assert(r.label === "possible meningitis", `label=${r.label}`);
});

// ===== Obstetric =====
t("pregnant with severe bleeding -> obstetric", () => {
  const r = triage("I am pregnant with severe bleeding since this morning.");
  assert(r !== null);
  assert(r.label === "obstetric emergency", `label=${r.label}`);
});

// ===== Cauda equina =====
t("severe back pain with leg weakness and saddle numbness -> cauda equina", () => {
  const r = triage("I have severe back pain with leg weakness and saddle numbness.");
  assert(r !== null);
  assert(r.label === "cauda equina symptoms", `label=${r.label}`);
});

// ===== Negative cases =====
t("'what is post-exertional malaise' -> null", () => {
  const r = triage("what is post-exertional malaise");
  assert(r === null, `expected null, got ${JSON.stringify(r)}`);
});

t("'tell me about ivabradine' -> null", () => {
  const r = triage("tell me about ivabradine");
  assert(r === null, `expected null, got ${JSON.stringify(r)}`);
});

t("empty string -> null", () => {
  assert(triage("") === null);
});

t("non-string input -> null", () => {
  assert(triage(null) === null, "null input should return null");
  assert(triage(undefined) === null, "undefined input should return null");
  assert(triage(42) === null, "number input should return null");
  assert(triage({}) === null, "object input should return null");
  assert(triage([]) === null, "array input should return null");
});

// ===== Summary =====
t("triageSummary returns sensible numbers", () => {
  const s = triageSummary();
  assert(typeof s === "object" && s !== null, "summary should be an object");
  assert(typeof s.total_categories === "number", "total_categories should be a number");
  assert(s.total_categories >= 7, `expected >=7 categories, got ${s.total_categories}`);
  assert(typeof s.total_patterns === "number", "total_patterns should be a number");
  assert(s.total_patterns >= s.total_categories, "total_patterns should be >= total_categories");
  assert(s.total_patterns >= 20, `expected >=20 patterns, got ${s.total_patterns}`);
  assert(Array.isArray(s.severities), "severities should be an array");
  assert(s.severities.length >= 1, "severities should be non-empty");
  assert(s.severities.includes("emergency"), `severities missing 'emergency': ${JSON.stringify(s.severities)}`);
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
