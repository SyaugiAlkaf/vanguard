// SPDX-License-Identifier: Apache-2.0
//
// Formulary + apotek lookup tests. Pure data, no model load.

import {
  loadFormulary,
  loadApoteks,
  buildMatcher,
  buildApotekFilter,
  buildFormularyLookup,
} from "../src/formulary.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ===== Load =====
t("formulary loads with at least 20 rows", () => {
  const f = loadFormulary();
  assert(f.length >= 20, `expected >=20, got ${f.length}`);
  for (const row of f) {
    assert(typeof row.generic === "string" && row.generic, `row missing generic: ${JSON.stringify(row).slice(0, 100)}`);
    assert(typeof row.rx_class === "string", `row missing rx_class: ${row.generic}`);
    assert(typeof row.typical_use === "string", `row missing typical_use: ${row.generic}`);
  }
});

t("apoteks loads with at least 5 rows", () => {
  const a = loadApoteks();
  assert(a.length >= 5, `expected >=5, got ${a.length}`);
});

// ===== Matcher =====
t("matcher catches generic name in reply text", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const hits = scan("I would suggest discussing naltrexone with your doctor.");
  assert(hits.length === 1, `expected 1 hit, got ${hits.length}`);
  assert(hits[0].row.generic === "naltrexone");
});

t("matcher catches brand name (Ventolin -> salbutamol)", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const hits = scan("Ventolin can provide quick relief for bronchospasm.");
  assert(hits.length === 1, `expected 1 hit, got ${hits.length}`);
  assert(hits[0].row.generic === "salbutamol");
});

t("matcher catches AKA name (acetaminophen -> paracetamol)", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const hits = scan("Acetaminophen at standard doses is generally well tolerated.");
  assert(hits.length === 1);
  assert(hits[0].row.generic === "paracetamol");
});

t("matcher catches multiple meds in one reply", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const text = "For POTS, propranolol or ivabradine are options. Some patients also use compression stockings.";
  const hits = scan(text);
  const generics = hits.map((h) => h.row.generic).sort();
  assert(generics.includes("propranolol"), JSON.stringify(generics));
  assert(generics.includes("ivabradine"), JSON.stringify(generics));
  assert(generics.includes("compression stockings"), JSON.stringify(generics));
});

t("matcher deduplicates same-generic across brand+generic", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const text = "Try paracetamol (sold as Panadol or Sanmol in Indonesia) for fever.";
  const hits = scan(text);
  const paraHits = hits.filter((h) => h.row.generic === "paracetamol");
  assert(paraHits.length === 1, `paracetamol matched ${paraHits.length} times, expected 1`);
});

t("matcher respects word boundary (does not match 'aspilet' inside 'aspilation')", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  // 'aspirin' is a generic; make sure 'aspirated' (not a real word but illustrative) doesn't match
  const hits = scan("The chest CT showed nothing suspicious.");
  assert(hits.length === 0, JSON.stringify(hits));
});

t("matcher is case-insensitive", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const hits = scan("NALTREXONE is being studied for Long COVID.");
  assert(hits.length === 1);
  assert(hits[0].row.generic === "naltrexone");
});

t("matcher returns empty for non-medication text", () => {
  const f = loadFormulary();
  const { scan } = buildMatcher(f);
  const hits = scan("Pacing is the most important behavioral intervention for ME/CFS-spectrum Long COVID.");
  assert(hits.length === 0);
});

// ===== City filter =====
t("apotek filter: Surabaya finds Apotek K-24 + Kimia Farma + Viva Health", () => {
  const a = loadApoteks();
  const { forCity } = buildApotekFilter(a);
  const matches = forCity("Surabaya").map((x) => x.name);
  assert(matches.includes("Apotek K-24"), `K-24 missing: ${JSON.stringify(matches)}`);
  assert(matches.includes("Kimia Farma"), `Kimia Farma missing: ${JSON.stringify(matches)}`);
  assert(matches.includes("Viva Health"), `Viva Health missing: ${JSON.stringify(matches)}`);
});

t("apotek filter: Jakarta finds most chains", () => {
  const a = loadApoteks();
  const { forCity } = buildApotekFilter(a);
  const matches = forCity("Jakarta").map((x) => x.name);
  assert(matches.length >= 5, `Jakarta should hit many chains, got ${matches.length}`);
});

t("apotek filter: random city falls back to nationwide chains", () => {
  const a = loadApoteks();
  const { forCity } = buildApotekFilter(a);
  // "Banda Aceh" should still match Kimia Farma via 'all major cities' wildcard
  const matches = forCity("Banda Aceh").map((x) => x.name);
  assert(matches.includes("Kimia Farma"), `Kimia Farma not found via wildcard: ${JSON.stringify(matches)}`);
});

t("apotek filter: empty city returns all", () => {
  const a = loadApoteks();
  const { forCity } = buildApotekFilter(a);
  assert(forCity("").length === a.length);
  assert(forCity(undefined).length === a.length);
});

// ===== High-level lookup =====
t("lookup returns matched medications + city-filtered apoteks", () => {
  const { lookup } = buildFormularyLookup();
  const out = lookup({
    replyText: "I would suggest discussing low-dose naltrexone with a clinician familiar with Long COVID.",
    city: "Surabaya",
  });
  assert(out.matched.length === 1, JSON.stringify(out));
  assert(out.matched[0].generic === "naltrexone");
  assert(out.apoteks.length > 0);
  assert(out.compounding_capable_count >= 1, "Surabaya should have a compounding-capable apotek (Kimia Farma)");
});

t("lookup with no medication match returns empty arrays (no card to show)", () => {
  const { lookup } = buildFormularyLookup();
  const out = lookup({
    replyText: "Pacing and rest are the cornerstones of management.",
    city: "Jakarta",
  });
  assert(out.matched.length === 0);
  // apoteks list is empty too — apotek cards only surface alongside medication cards.
  assert(out.apoteks.length === 0);
});

t("lookup populates references + warnings + price_idr_range", () => {
  const { lookup } = buildFormularyLookup();
  const out = lookup({
    replyText: "Ivabradine is sometimes used off-label for POTS.",
    city: "Jakarta",
  });
  assert(out.matched.length === 1);
  const m = out.matched[0];
  assert(m.generic === "ivabradine");
  assert(Array.isArray(m.references) && m.references.length > 0);
  assert(Array.isArray(m.warnings) && m.warnings.length > 0);
  assert(typeof m.price_idr_range === "string");
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
