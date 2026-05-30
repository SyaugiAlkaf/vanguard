// SPDX-License-Identifier: Apache-2.0
import {
  LABELS,
  ATTACK_LABELS,
  ALL_LABELS,
  isAttackLabel,
  isValidLabel,
} from "../src/labels.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

t("LABELS contains the 4 expected classes", () => {
  assert(LABELS.SAFE === "SAFE", "SAFE");
  assert(LABELS.INJECTION === "INJECTION", "INJECTION");
  assert(LABELS.JAILBREAK === "JAILBREAK", "JAILBREAK");
  assert(LABELS.EXFILTRATION === "EXFILTRATION", "EXFILTRATION");
});

t("ATTACK_LABELS excludes SAFE", () => {
  assert(!ATTACK_LABELS.includes("SAFE"), "SAFE should not be in ATTACK_LABELS");
  assert(ATTACK_LABELS.length === 3, "expect 3 attack labels");
});

t("ALL_LABELS has 4 entries in stable order", () => {
  assert(ALL_LABELS.length === 4, "4 labels");
  assert(ALL_LABELS[0] === "SAFE", "SAFE first");
});

t("isAttackLabel: INJECTION true, SAFE false, garbage false", () => {
  assert(isAttackLabel("INJECTION"), "INJECTION");
  assert(!isAttackLabel("SAFE"), "SAFE");
  assert(!isAttackLabel("FOO"), "FOO");
});

t("isValidLabel accepts all 4, rejects garbage", () => {
  assert(isValidLabel("SAFE"), "SAFE valid");
  assert(isValidLabel("EXFILTRATION"), "EXFILTRATION valid");
  assert(!isValidLabel("hello"), "hello invalid");
  assert(!isValidLabel(""), "empty invalid");
});

let pass = 0;
let fail = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`pass: ${name}`);
    pass++;
  } catch (e) {
    console.error(`FAIL: ${name} -- ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
