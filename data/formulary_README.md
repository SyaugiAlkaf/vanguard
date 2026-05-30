# Hearth formulary data

`formulary_id.jsonl` and `apoteks_id.jsonl` are static reference datasets surfaced by Hearth after MedGemma generates a clinical response. They are not live data and are not used to recommend medications; they are looked up only when MedGemma's reply mentions a medication that exists in the formulary.

## Disclaimer

This data is illustrative reference material for the QVAC Hackathon I Hearth demonstration. It is curated from public sources (BPOM public registry, WHO Essential Medicines List, BNF, AHA POTS scientific statement 2022, Long COVID Research Initiative protocols, NIH ODS fact sheets) and represents typical Indonesian medication landscape at the time of writing. **It is not medical advice, is not a prescribing reference, is not real-time pharmacy inventory, and does not reflect current BPOM registration status.** Patients must consult licensed clinicians and verify all medication information directly with their pharmacy.

The dataset is intentionally small (~25 medications, ~10 pharmacy chains). Operators in production are expected to expand or replace this seed data with their own verified sources.

## Schema

`formulary_id.jsonl` — one JSON object per line:

```json
{
  "generic": "naltrexone",
  "aka": ["alternative names"],
  "brand_id": ["Naltrexin (Pharos)"],
  "rx_class": "Rx | OTC | OTC for low strengths, Rx for higher | OTC (supplement)",
  "typical_use": "indication summary",
  "kuhp_flag": null | "string explaining KUHP 2026 boundary",
  "license_status": "BPOM-registered | limited availability | ...",
  "price_idr_range": "approximate retail range",
  "references": ["WHO EML 2023", "BNF 86", "PMID X"],
  "warnings": ["array of clinician-relevant notes"]
}
```

`apoteks_id.jsonl` — one JSON object per line:

```json
{
  "name": "Apotek K-24",
  "chain": true,
  "national_coverage": ["city list"],
  "hours_typical": "24/7 | varies | mall hours",
  "phone_central": "+62-...",
  "url": "https://...",
  "accepts_bpjs": true | false,
  "compounding_capable": true | false,
  "notes": "free-form context"
}
```

## How Hearth uses it

1. After MedGemma replies, the server scans the reply for matches against `formulary_id.jsonl` (generic + brand names).
2. Matches surface as small expandable cards under the reply: "Naltrexone — Rx-only in Indonesia, BPOM-registered as Naltrexin, ~180k-350k IDR/month for LDN, compounding-capable apoteks: Kimia Farma, Apotek Wellings."
3. The patient picks their city in `localStorage` (set on first visit). No GPS, no IP geolocation.
4. Apotek cards display only chains with national_coverage intersecting the chosen city.

The medication detection runs locally and never sends data to any external service.

## Updating

To replace or expand:
1. Edit the JSONL files directly. Each line must be valid JSON.
2. The Hearth server reads them at boot. Restart Hearth after changes.
3. Sources for additions should be cited in the `references` array.
4. Always verify clinical info (dosing, contraindications) against current authoritative formularies.

## Sources used for the shipped seed

- WHO Model List of Essential Medicines (22nd edition, 2023)
- British National Formulary (BNF) 86 (2023-2024)
- BPOM (Indonesian Food & Drug Authority) public registry
- AHA Scientific Statement on POTS (2022)
- Long COVID Research Initiative published protocols
- NIH Office of Dietary Supplements fact sheets
- AASM clinical guidelines (melatonin)
- AASM and Endocrine Society guidelines (vitamin D)

## License

This curated dataset is published under [Apache 2.0](../LICENSE) like the rest of Vanguard. Upstream attribution for clinical references is the responsibility of the consumer.
