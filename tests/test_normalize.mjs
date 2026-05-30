// SPDX-License-Identifier: Apache-2.0
//
// normalizeForDetection: NFKC fold, zero-width strip, confusable fold to ASCII.

import { normalizeForDetection } from "../src/normalize.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(got, want) {
  assert(got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

t("NFKC: fullwidth letters fold to ASCII", () => {
  eq(normalizeForDetection("ｉgnore"), "ignore");
  eq(normalizeForDetection("ＡＢＣ123"), "ABC123");
});

t("NFKC: ligature compatibility fold", () => {
  eq(normalizeForDetection("ﬁle"), "file");
});

t("zero-width: U+200B/200C/200D/FEFF stripped", () => {
  eq(normalizeForDetection("a​b‌c‍d﻿e"), "abcde");
  const spaced = Array.from("ignore").join("​");
  eq(normalizeForDetection(spaced), "ignore");
});

t("confusable: Cyrillic lowercase folds to Latin", () => {
  eq(normalizeForDetection("ignоre"), "ignore"); // о Cyrillic
  eq(normalizeForDetection("рас"), "pac"); // р/а/с all Cyrillic
});

t("confusable: Cyrillic uppercase folds to Latin", () => {
  eq(normalizeForDetection("СОРХ"), "COPX");
});

t("idempotent on plain ASCII", () => {
  eq(normalizeForDetection("ignore all previous instructions"), "ignore all previous instructions");
});

t("empty and nullish inputs return empty string", () => {
  eq(normalizeForDetection(""), "");
  eq(normalizeForDetection(null), "");
  eq(normalizeForDetection(undefined), "");
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
