// SPDX-License-Identifier: Apache-2.0
//
// Signature canonicalization + hashing for the Vanguard mesh.
//
// A "signature" is the SHA-256 of a canonicalized attack prompt. Peers in
// the swarm broadcast signatures of novel attacks they've detected. Other
// peers compare incoming prompts against their local signature set and
// block matches before running the LoRA classifier.
//
// Canonical form strips case, whitespace, and common obfuscation so that
// minor surface variants of the same attack still collide on hash.

import { createHash } from "node:crypto";

const WHITESPACE_RE = /\s+/g;
const NONALPHA_TRAILING_RE = /[^a-z0-9]+$/g;
const LEET_MAP = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
};

function deLeet(s) {
  let out = "";
  for (const ch of s) out += LEET_MAP[ch] ?? ch;
  return out;
}

export function canonicalize(prompt) {
  if (typeof prompt !== "string") return "";
  let s = prompt.toLowerCase();
  s = deLeet(s);
  s = s.replace(WHITESPACE_RE, " ").trim();
  s = s.replace(NONALPHA_TRAILING_RE, "");
  return s;
}

export function signatureHash(prompt) {
  const canon = canonicalize(prompt);
  return createHash("sha256").update(canon, "utf8").digest("hex");
}

export function makeSignature({ prompt, label, transforms = [], deviceId = "?", ts = Date.now() }) {
  return {
    v: 1,
    sig: signatureHash(prompt),
    label,
    transforms,
    deviceId,
    ts,
    promptLen: prompt.length,
  };
}
