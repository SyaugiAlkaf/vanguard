// SPDX-License-Identifier: Apache-2.0
//
// Detection-time normalization. Attackers hide the English attack words the
// heuristic regexes match by swapping ASCII letters for Unicode confusables
// (Cyrillic о for o), inserting zero-width characters between letters, or
// using fullwidth forms. NFKC + zero-width strip + confusable folding collapse
// all of those back to the ASCII the regexes expect. This is lossy and only
// for matching — never feed the result to a model as the user's real text.

const ZERO_WIDTH_RE = /[​-‍﻿]/g;

const CONFUSABLES = {
  "а": "a", // Cyrillic а
  "е": "e", // Cyrillic е
  "о": "o", // Cyrillic о
  "р": "p", // Cyrillic р
  "с": "c", // Cyrillic с
  "х": "x", // Cyrillic х
  "А": "A",
  "Е": "E",
  "О": "O",
  "Р": "P",
  "С": "C",
  "Х": "X",
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

export function normalizeForDetection(text) {
  const s = (text ?? "").toString();
  if (!s) return "";
  // NFKC folds fullwidth forms (ｉ -> i) and other compatibility variants.
  return s
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch]);
}
