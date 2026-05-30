# Vanguard architecture

Vanguard is a sovereign on-device prompt-injection firewall for local large language models. It runs in three concentric layers in front of a host LLM. Every prompt walks through them in order; the cheapest filter that flags an attack wins, and the host model never sees the input.

## The three layers

```
prompt
  |
  v
+----------------------------------------+
| Layer 1  Heuristic regex               |   ~0.5 ms        no model
|          46 patterns, ASCII English    |
+----------------------------------------+
  | miss
  v
+----------------------------------------+
| Layer 2  Mesh signature lookup         |   ~10 ms         no model
|          SHA-256 of canonicalized      |
|          prompt against local Hyperbee |
|          replicated peer-to-peer via   |
|          Hyperswarm DHT                |
+----------------------------------------+
  | miss
  v
+----------------------------------------+
| Layer 3  LoRA classifier on Qwen3-1.7B |   ~3.6 s p50
|          ~70 MB adapter, runs via      |   ~10.2 s p95
|          @qvac/sdk in Bare runtime     |
+----------------------------------------+
  | verdict ∈ {SAFE, INJECTION, JAILBREAK, EXFILTRATION}
  v
SAFE      -> host LLM runs (MedGemma 4B / Qwen3 / your choice)
non-SAFE  -> throw RequestRejectedByPolicyError (SDK-native)
```

The same `RequestRejectedByPolicyError` is the QVAC SDK's own policy-rejection error. Downstream consumers catch a well-known error type without learning Vanguard-specific vocabulary.

## Why three layers

| Layer | Catches | Misses (by design) | Cost |
|---|---|---|---|
| 1 — Heuristic | 46 curated regex patterns covering canonical attack templates and their surface variants (whitespace, case, punctuation), several mined from the SaTML-24 CTF and In-the-Wild jailbreak corpora. On a held-out 1,710-row novel corpus: 37.1% recall at 97.6% precision, 0.43% false-positive rate. | Multilingual, encoded (base64/ROT13/hex), unicode lookalikes, punctuation-jittered text, URL-fragment slugs, multi-turn escalation. | ~0.5 ms per prompt |
| 2 — Mesh signature | Exact and canonicalized variants of attacks already known to your fleet. Operator pre-seeds 727 canonical signatures from `data/mesh_seed.jsonl` (180 demo seeds plus 547 mined from the SaTML-24 and In-the-Wild corpora). Devices joining the same Hyperswarm topic replicate new signatures peer-to-peer. | Novel attacks the fleet has not seen yet. | ~10 ms per prompt |
| 3 — LoRA classifier | The residual: harder pretext attacks, paraphrases, mid-novel exfiltration. The shipping adapter is **v4 step-800**: trained on a 2,400-row class-balanced corpus from Lakera Gandalf (kept as EXFIL for sysprompt-summarization variants), JailbreakBench, deepset, NVIDIA Garak, HarmBench, plus 108 hand-curated EXFILTRATION rows and 200 hard-negative SAFE rows. v4 doubled the unique EXFIL pool over v2 (148 → 286 by relabeling Lakera gandalf_summarization as EXFIL — context-leak-via-summary is a real EXFIL vector). Corpus-level: **91.48% binary blocked F1, 93.22% precision, 89.80% recall, 7.92% FP rate**. | EXFILTRATION is still the weakest class at 25.64% F1 (improved from v2's 16.33%) — small unique-example pool. Documented in `artifacts/training/eval_report.json`. | ~506 ms p50, ~909 ms p95 on Apple M5 |

A soft-suspicion check (`src/suspicion.mjs`) sits behind the classifier: when layer 3 returns SAFE but two or more independent attack markers co-occur, the verdict is escalated to a block. Tuned to add zero false positives on the benign + hard-negative corpus; recovers ~9% of the attacks the other layers slip.

The two front layers are *never-false-block*. On the unbiased novel holdout the heuristic blocks 5 out of 1,173 SAFE prompts (0.43%) — the mesh signature lookup is exact-match on canonicalized hash, so its false-positive rate depends entirely on what the operator pre-seeded. Layer 3 carries the highest recall but the lowest precision, so it only fires when the cheaper layers fall through.

## Mesh — peer-to-peer signature propagation

```
     YOUR LAPTOP                              YOUR PHONE
+---------------------+                  +---------------------+
| local SignatureStore|                  | local SignatureStore|
|  - Hyperbee log     |                  |  - Hyperbee log     |
|  - canonical SHA-256|                  |  - canonical SHA-256|
|  - block-on-match   |                  |  - block-on-match   |
+---------------------+                  +---------------------+
           ^                                       ^
           |                                       |
           +--------- Hyperswarm DHT ----------+
                 topic = sha256("vanguard-mesh:" + secret)
```

The mesh has no server. Devices announce themselves to the DHT under a topic derived from a shared secret, find each other, and replicate their SignatureStores peer-to-peer. Pull the network cable; the local mesh still defends. Reconnect; replication resumes from the last common state.

Three operating modes the operator picks:

- **Solo** — single device, secret nobody else knows. The mesh degenerates to a local cache.
- **Family** — phones and laptops you trust, secret shared verbally. Novel attacks on any device propagate to all of them within seconds.
- **Community** — public topic. Anyone with the secret joins. Higher attack catch, less trust in the signatures.

The current canonicalization (`src/mesh/signatures.mjs`) lowercases, strips whitespace, collides minor punctuation variants, and de-leet-substitutes (`0→o`, `1→i`, etc.) before SHA-256-hashing. Two surface variants of the same attack collide on the same hash.

## Modality reduction — handling image inputs

Hearth (`apps/hearth/`) accepts image uploads. Vanguard does not classify image bytes directly; instead it uses an **input-modality-reduction** pattern:

```
patient drops a lab-report screenshot
   |
   v
Qwen3-VL-2B (multimodal, loaded via @qvac/sdk QWEN3VL_2B_MULTIMODAL_Q4_K + mmproj)
   |
   v text description ("heart rate chart, 130 bpm when standing")
Vanguard layers 1-3 (heuristic + mesh + LoRA) on the description
   |
   v SAFE
MedGemma 4B host receives  "Image description: ... \n\n User question: ..."
```

Every input is reduced to text *before* Vanguard runs. Steganographic prompt injection, QR-code payloads, and image-embedded "ignore previous instructions" snippets all surface as text in the vision model's description and get caught by the same three layers that defend text-only chats.

Vision is opt-in (`HEARTH_VISION=1`) because Qwen3-VL-2B + mmproj is ~1.5 GB on first download. With it off, Hearth falls back to a stub that returns a sentinel string; the UI is still exercisable but won't generate real descriptions.

## Red-flag triage

Before any classifier runs, Hearth scans the patient's text for clinical red flags — symptoms that warrant urgent care. The triage module (`src/triage.mjs`) holds nine pattern groups across two severities (`emergency`, `urgent`) covering cardiac, stroke, anaphylaxis, severe shortness of breath, suicidality, acute abdomen, meningitis, obstetric emergencies, and cauda equina red flags. Patterns are drawn from MERCK Manual, NHS triage references, and AHA POTS Scientific Statement 2022 red-flag carve-outs.

When a match fires, Hearth surfaces a red banner above the assistant turn with the severity, the matched phrase, and a concrete next step (Indonesian emergency numbers 118/119 by default; US 911 as alternative). The triage banner shows *regardless of the verdict* — even if the prompt also contains an injection attempt, the patient sees the safety message. The classifier still runs and the model still blocks the injection separately.

This is layered safety information, not a diagnosis. False positives are acceptable; the absence of a banner does not mean "you are fine."

## Clinical question templates

After MedGemma replies, Hearth scans the reply for topic keywords (Long COVID, POTS, ME/CFS, MCAS, hypertension, type 2 diabetes, depression/anxiety) and surfaces a curated set of 4-6 patient-actionable questions to bring to a clinician — what tests to ask for, what biomarkers, what to track over time, what alternatives if the first plan does not work. Templates are in `src/clinical_questions.mjs`, sourced from AHA Scientific Statement on POTS 2022 patient-facing addendum, NHS Long COVID care guidance, Long COVID Research Initiative patient FAQ, and Mount Sinai Cohen Long COVID Center patient handouts.

## Medication card surfacing

After MedGemma generates a reply, Hearth scans the text for medication names against a static `data/formulary_id.jsonl` (27 medications, curated from WHO EML 2023, BNF 86, BPOM public registry, AHA POTS scientific statement 2022, Long COVID Research Initiative protocols). Matches surface as small expandable cards under the reply. Each card shows:

- Generic name + Rx/OTC class
- Brand names available in Indonesia (BPOM-registered)
- Typical use, license status, indicative price range
- Warnings and references
- A filtered list of pharmacy chains in the patient's chosen city (from `data/apoteks_id.jsonl`), with `BPJS-accepting`, `compounding-capable`, and `24/7` tags

The patient picks their city once, saved to `localStorage`. **No GPS. No IP geolocation. No external maps API.** This is reference information, not medication recommendation — the patient still consults a clinician. The sovereignty guarantee holds end-to-end.

## What is not in scope

- Vanguard does not generate refusals. The host LLM decides what to say on SAFE prompts. Vanguard only decides whether the host gets to run.
- Vanguard does not validate tool calls. A malicious tool output can still smuggle instructions into the next turn. (Workaround: pass the tool-output text through `classify()` before adding it to history.)
- Vanguard does not currently re-classify after multi-turn escalation. `safeCompletion` classifies the latest user message only. An attacker who warms the conversation with benign turns and drops the payload in turn N is caught only if turn N is independently attack-shaped. Closing this is on the roadmap.
- The formulary is static, not live pharmacy inventory. Operators are expected to verify availability with the actual apotek.
- The formulary ships with Indonesian data only. Other jurisdictions can swap `formulary_*.jsonl` and `apoteks_*.jsonl` per the schema in `data/formulary_README.md`.

## File map

```
src/
  classifier.mjs    layer-3 entry; runs heuristic then mesh then LoRA
  heuristics.mjs    46 regex patterns
  mesh/
    signatures.mjs  canonicalize + sha256
    store.mjs       Hyperbee-backed local SignatureStore
    swarm.mjs       Hyperswarm join/leave
    index.mjs       startMesh() high-level handle
  vision.mjs        Qwen3-VL-2B wrapper + stub fallback + NOT_MEDICAL gate
  formulary.mjs     loadFormulary + matcher + apotek filter
  triage.mjs        red-flag pattern matcher (cardiac, stroke, suicidality, etc.)
  clinical_questions.mjs  topic-keyed "questions for your clinician" templates
  plugin.mjs        vanguardFirewall.attach() — public API
  safe-completion.mjs   safeCompletion() — convenience wrapper
  cli.mjs           guard / ask / version commands
  index.mjs         re-exports

apps/
  hearth/           patient-facing browser app: chat, image upload,
                    medication cards, city-filtered apoteks

data/
  raw/                  upstream attack + benign corpora
  sft/                  training splits (train_v2.jsonl, val_v2.jsonl)
  mesh_seed.jsonl       727 canonical signatures shipped with the repo
  formulary_id.jsonl    27 medications (Indonesia)
  apoteks_id.jsonl      10 pharmacy chains (Indonesia)
  formulary_README.md   schema + disclaimer + sources

artifacts/
  lora/adapter.gguf training output (the LoRA the classifier loads)
  training/         loss trace + eval report
  hardware.json     M5 / 24GB capture
  audit.jsonl       sample demo session
  screenshots/      e2e-captured Hearth screenshots
```

## Reproducibility

Every claim has a file behind it. To verify on your hardware:

```bash
git clone https://github.com/SyaugiAlkaf/vanguard.git
cd vanguard
npm install
npm test                                  # 254 unit + integration tests
node scripts/smoke.mjs                    # confirms SDK + model load
node scripts/eval_heuristic_only.mjs      # rerun the heuristic eval
node scripts/eval_detector.mjs \
  --base qwen3_1_7b \
  --adapter $(pwd)/artifacts/lora/adapter.gguf \
  --val data/sft/val.jsonl                # rerun the combined eval
node src/demo/medpsy/run.mjs              # Vanguard guarding MedGemma 4B
npm run hearth                            # boot the chat UI on localhost:7777
```

Reports are written to `artifacts/`. Verbatim numbers: 70.92% binary blocked F1, 94.56% precision, 3.96% FP rate, 16.33% EXFILTRATION F1 (the documented weakness). The training procedure is in `scripts/train_lora.mjs` and `scripts/prepare_v2_dataset.mjs`.

## License

[Apache 2.0](../LICENSE). The full third-party attribution stack is in [`NOTICE.md`](../NOTICE.md).
