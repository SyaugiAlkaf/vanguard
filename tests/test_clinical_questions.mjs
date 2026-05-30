// SPDX-License-Identifier: Apache-2.0
//
// Topic-keyed clinical questions tests. Pure regex over reply text.

import { suggestQuestions, topicsSummary } from "../src/clinical_questions.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ===== Long COVID =====
t("'Long COVID is a complex condition' -> Long COVID with >=4 questions", () => {
  const r = suggestQuestions("Long COVID is a complex condition with many manifestations.");
  assert(r !== null, "expected match, got null");
  assert(r.topic === "Long COVID", `topic=${r.topic}`);
  assert(Array.isArray(r.questions), "questions should be an array");
  assert(r.questions.length >= 4, `expected >=4 questions, got ${r.questions.length}`);
  for (const q of r.questions) {
    assert(typeof q === "string" && q.length > 0, "each question should be a non-empty string");
  }
});

t("'PASC patients often experience...' -> Long COVID", () => {
  const r = suggestQuestions("PASC patients often experience fatigue and brain fog.");
  assert(r !== null);
  assert(r.topic === "Long COVID", `topic=${r.topic}`);
});

// ===== POTS =====
t("'POTS is a form of dysautonomia' -> POTS", () => {
  const r = suggestQuestions("POTS is a form of dysautonomia.");
  assert(r !== null);
  assert(r.topic.includes("POTS"), `topic=${r.topic}`);
  assert(r.topic.includes("Postural Orthostatic Tachycardia"), `topic=${r.topic}`);
});

t("'dysautonomia management' -> POTS", () => {
  const r = suggestQuestions("dysautonomia management often involves fluids and salt.");
  assert(r !== null);
  assert(r.topic.includes("POTS"), `topic=${r.topic}`);
});

// ===== ME/CFS =====
t("'ME/CFS' -> ME/CFS", () => {
  const r = suggestQuestions("ME/CFS is poorly understood and often disabling.");
  assert(r !== null);
  assert(r.topic.includes("ME/CFS"), `topic=${r.topic}`);
});

t("'chronic fatigue syndrome' -> ME/CFS", () => {
  const r = suggestQuestions("chronic fatigue syndrome is poorly understood.");
  assert(r !== null);
  assert(r.topic.includes("ME/CFS"), `topic=${r.topic}`);
});

// ===== MCAS =====
t("'Mast cell activation' -> MCAS", () => {
  const r = suggestQuestions("Mast cell activation can cause flushing and GI symptoms.");
  assert(r !== null);
  assert(r.topic.includes("MCAS"), `topic=${r.topic}`);
});

t("'histamine intolerance' -> MCAS", () => {
  const r = suggestQuestions("histamine intolerance overlaps with MCAS clinically.");
  assert(r !== null);
  assert(r.topic.includes("MCAS"), `topic=${r.topic}`);
});

// ===== Hypertension =====
t("'managing your hypertension' -> hypertension", () => {
  const r = suggestQuestions("managing your hypertension requires lifestyle changes.");
  assert(r !== null);
  assert(r.topic.includes("hypertension"), `topic=${r.topic}`);
});

// ===== Diabetes =====
t("'Type 2 diabetes' -> diabetes", () => {
  const r = suggestQuestions("Type 2 diabetes responds well to GLP-1 therapy.");
  assert(r !== null);
  assert(r.topic.includes("diabetes"), `topic=${r.topic}`);
});

t("'your A1c' -> diabetes", () => {
  const r = suggestQuestions("Tracking your A1c every three months is reasonable.");
  assert(r !== null);
  assert(r.topic.includes("diabetes"), `topic=${r.topic}`);
});

// ===== Depression/anxiety =====
t("'depression and anxiety' -> depression / anxiety", () => {
  const r = suggestQuestions("depression and anxiety often co-occur.");
  assert(r !== null);
  assert(r.topic.includes("depression"), `topic=${r.topic}`);
});

// ===== Negative cases =====
t("'pacing alone is the answer' -> null (no topic word match)", () => {
  const r = suggestQuestions("pacing alone is the answer for some patients.");
  assert(r === null, `expected null, got ${JSON.stringify(r)}`);
});

t("empty string -> null", () => {
  assert(suggestQuestions("") === null);
});

t("null / undefined -> null", () => {
  assert(suggestQuestions(null) === null, "null input should return null");
  assert(suggestQuestions(undefined) === null, "undefined input should return null");
});

// ===== Summary =====
t("topicsSummary returns >=7 entries with shape {topic, questionCount}", () => {
  const s = topicsSummary();
  assert(Array.isArray(s), "summary should be an array");
  assert(s.length >= 7, `expected >=7 topics, got ${s.length}`);
  for (const entry of s) {
    assert(typeof entry.topic === "string" && entry.topic.length > 0, `bad topic: ${JSON.stringify(entry)}`);
    assert(typeof entry.questionCount === "number", `bad questionCount: ${JSON.stringify(entry)}`);
    assert(entry.questionCount >= 4, `topic '${entry.topic}' should have >=4 questions, got ${entry.questionCount}`);
  }
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
