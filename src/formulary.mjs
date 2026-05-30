// SPDX-License-Identifier: Apache-2.0
//
// Formulary + apotek lookup. Static JSONL data, regex-matched against
// MedGemma's reply text. No network. No GPS. The user picks their city
// manually; we filter apotek cards to chains present in that city.
//
// IMPORTANT: This is reference information, not medical advice. We
// surface what's in the formulary when the model mentions it; the patient
// still consults a clinician.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const DEFAULT_FORMULARY = resolve(ROOT, "data/formulary_id.jsonl");
const DEFAULT_APOTEKS = resolve(ROOT, "data/apoteks_id.jsonl");

function readJsonl(path) {
  const text = readFileSync(path, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (_e) {
      /* skip malformed */
    }
  }
  return rows;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Loads a formulary dataset. Each row is {generic, aka, brand_id, ...}.
 */
export function loadFormulary(path = DEFAULT_FORMULARY) {
  return readJsonl(path);
}

/**
 * Loads the apotek dataset.
 */
export function loadApoteks(path = DEFAULT_APOTEKS) {
  return readJsonl(path);
}

/**
 * Build a matcher from a formulary array. Pre-compiles regex for each
 * row so repeated scans are fast.
 *
 * @returns { scan(text) -> [{ row, hit: matchString }] }
 */
export function buildMatcher(formulary) {
  const compiled = formulary.map((row) => {
    const names = new Set();
    if (row.generic) names.add(row.generic);
    if (Array.isArray(row.aka)) for (const a of row.aka) names.add(a);
    if (Array.isArray(row.brand_id)) {
      for (const b of row.brand_id) {
        // Brand entries often have parenthetical manufacturer; strip it.
        // "Naltrexin (Pharos)" -> "Naltrexin"
        const bare = String(b).replace(/\s*\(.*?\)\s*/g, "").trim();
        if (bare) names.add(bare);
      }
    }
    const patterns = [];
    for (const name of names) {
      if (!name) continue;
      // Word-boundary, case-insensitive. Treat hyphen as a soft boundary
      // so "low-dose naltrexone" matches "naltrexone".
      patterns.push(new RegExp(`\\b${escapeRegExp(name)}\\b`, "i"));
    }
    return { row, patterns, names: [...names] };
  });

  function scan(text) {
    const t = String(text ?? "");
    if (!t) return [];
    const hits = [];
    const seenGenerics = new Set();
    for (const { row, patterns } of compiled) {
      for (const re of patterns) {
        const m = t.match(re);
        if (m) {
          if (seenGenerics.has(row.generic)) break;
          seenGenerics.add(row.generic);
          hits.push({ row, hit: m[0] });
          break;
        }
      }
    }
    return hits;
  }

  return { scan, compiled };
}

/**
 * Build an apotek filter. Given a city, returns apoteks whose
 * national_coverage includes that city (case-insensitive substring,
 * since coverage lists vary in detail).
 */
export function buildApotekFilter(apoteks) {
  function forCity(city) {
    if (!city || typeof city !== "string") return apoteks;
    const c = city.toLowerCase().trim();
    return apoteks.filter((a) => {
      if (!Array.isArray(a.national_coverage)) return false;
      for (const cov of a.national_coverage) {
        if (typeof cov !== "string") continue;
        const lc = cov.toLowerCase();
        // "all major cities" wildcards always match
        if (/all/.test(lc) || /nationwide/.test(lc)) return true;
        if (lc.includes(c)) return true;
      }
      return false;
    });
  }
  return { forCity };
}

/**
 * High-level: given a reply text and a city, return matched medication
 * cards with compounding-capable apoteks in that city.
 */
export function buildFormularyLookup({ formularyPath, apoteksPath } = {}) {
  const formulary = loadFormulary(formularyPath);
  const apoteks = loadApoteks(apoteksPath);
  const matcher = buildMatcher(formulary);
  const apotekFilter = buildApotekFilter(apoteks);

  function lookup({ replyText, city }) {
    const hits = matcher.scan(replyText);
    if (hits.length === 0) return { matched: [], apoteks: [] };

    const cityApoteks = apotekFilter.forCity(city);
    const compounding = cityApoteks.filter((a) => a.compounding_capable);

    const matched = hits.map(({ row, hit }) => ({
      hit,
      generic: row.generic,
      aka: row.aka ?? [],
      brand_id: row.brand_id ?? [],
      rx_class: row.rx_class,
      typical_use: row.typical_use,
      license_status: row.license_status,
      price_idr_range: row.price_idr_range,
      references: row.references ?? [],
      warnings: row.warnings ?? [],
      kuhp_flag: row.kuhp_flag ?? null,
      needs_compounding: typeof row.license_status === "string" &&
        /compounding/i.test(row.license_status + " " + (row.warnings ?? []).join(" ")),
    }));

    return {
      matched,
      apoteks: cityApoteks.map((a) => ({
        name: a.name,
        accepts_bpjs: !!a.accepts_bpjs,
        compounding_capable: !!a.compounding_capable,
        hours_typical: a.hours_typical,
        phone_central: a.phone_central,
        url: a.url,
        notes: a.notes,
      })),
      compounding_capable_count: compounding.length,
      formulary_size: formulary.length,
      apotek_size_for_city: cityApoteks.length,
    };
  }

  return { lookup, formulary, apoteks };
}
