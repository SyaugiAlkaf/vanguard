// SPDX-License-Identifier: Apache-2.0

export const LABELS = Object.freeze({
  SAFE: "SAFE",
  INJECTION: "INJECTION",
  JAILBREAK: "JAILBREAK",
  EXFILTRATION: "EXFILTRATION",
});

export const ATTACK_LABELS = Object.freeze([
  LABELS.INJECTION,
  LABELS.JAILBREAK,
  LABELS.EXFILTRATION,
]);

export const ALL_LABELS = Object.freeze(Object.values(LABELS));

export function isAttackLabel(label) {
  return ATTACK_LABELS.includes(label);
}

export function isValidLabel(label) {
  return ALL_LABELS.includes(label);
}
