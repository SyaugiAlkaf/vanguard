// SPDX-License-Identifier: Apache-2.0
// Tests the classifier's parseLabel logic by re-implementing the regex paths,
// so we don't need to load a model just to verify text parsing.

const ALL_LABELS = ["SAFE", "INJECTION", "JAILBREAK", "EXFILTRATION"];
const VERDICT_RE = /\bverdict\s*[:\-]?\s*(SAFE|INJECTION|JAILBREAK|EXFILTRATION)\b/i;

function parseLabel(text) {
  const t = (text ?? "").toString();
  const m = t.match(VERDICT_RE);
  if (m) return { label: m[1].toUpperCase(), fallback: false, mode: "verdict" };
  const upper = t.toUpperCase();
  for (const label of ALL_LABELS) {
    if (upper.indexOf(label) !== -1)
      return { label, fallback: false, mode: "substring" };
  }
  return { label: "SAFE", fallback: true, mode: "fallback" };
}

const cases = [
  { in: "Verdict: SAFE. Reason: benign.", expect: "SAFE", mode: "verdict" },
  { in: "Verdict: INJECTION. Reason: tries to override.", expect: "INJECTION", mode: "verdict" },
  { in: "verdict:JAILBREAK", expect: "JAILBREAK", mode: "verdict" },
  { in: "Verdict - EXFILTRATION. Reason: tries to extract secrets.", expect: "EXFILTRATION", mode: "verdict" },
  { in: "INJECTION", expect: "INJECTION", mode: "substring" },
  { in: "this looks like a JAILBREAK attempt", expect: "JAILBREAK", mode: "substring" },
  { in: "", expect: "SAFE", mode: "fallback" },
  { in: "I cannot answer that", expect: "SAFE", mode: "fallback" },
  { in: "<think>\n</think>\n\nVerdict: EXFILTRATION.", expect: "EXFILTRATION", mode: "verdict" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = parseLabel(c.in);
  const ok = got.label === c.expect && got.mode === c.mode;
  console.log(`${ok ? "pass" : "FAIL"}: ${JSON.stringify(c.in.slice(0, 60))} -> ${got.label}/${got.mode} (expected ${c.expect}/${c.mode})`);
  if (ok) pass++;
  else fail++;
}
console.log(`\n${pass}/${cases.length} passed`);
if (fail > 0) process.exit(1);
