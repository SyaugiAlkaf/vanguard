# Hearth

> **A sovereign clinical chat on your own hardware.**
> Vanguard runs in front of every prompt. MedGemma 4B answers the benign ones. No cloud, no telemetry, no intermediaries.

Hearth is the patient-facing demonstration of [Vanguard](../..). It is a single-page browser app served by a local Node process. The QVAC SDK loads the Qwen3-1.7B classifier (with the Vanguard LoRA adapter) and MedGemma 4B on startup; you open `http://localhost:7777` and start chatting. Every prompt is classified before the host model runs. Attacks are blocked; benign clinical queries get a real MedGemma reply.

## Why local

Patients with chronic conditions (Long COVID, dysautonomia, ME/CFS) increasingly turn to LLMs for clinical reasoning their healthcare systems cannot provide quickly. Cloud telehealth in some jurisdictions ships sensitive PII outside the user's legal protections. Sovereignty is not a slogan for those users — it is the only model that exists.

Hearth runs the whole stack on your machine. There is no network call after the first-time model fetch.

## Run it

From the repo root:

```
npm install
node apps/hearth/server.mjs
```

Then open `http://localhost:7777`.

First launch downloads Qwen3-1.7B Q4 (~1.0 GB) and MedGemma 4B Q4 (~2.4 GB) into the QVAC SDK cache. Subsequent launches are fast.

Environment overrides:

- `HEARTH_PORT=8080` — change the listening port (default 7777)
- `HEARTH_VISION=1` — load Qwen3-VL-2B + mmproj (~1.5 GB first download). Unlocks the image-attach flow with the `NOT_MEDICAL` rejection gate.
- `HEARTH_OCR=1` — load LightOnOCR-2-1B + mmproj (~1.5 GB first download). Unlocks the OCR document button with the `NOT_DOCUMENT` rejection gate.
- `HEARTH_NO_MESH=1` — skip the Hyperswarm signature mesh layer (useful if another process holds the lock)
- `HEARTH_NO_MODELS=1` — UI dev mode; loads the heuristic + mesh layers only, instant boot, no LLM calls
- `HEARTH_MESH_STORAGE=/path` — point the SignatureStore at a non-default storage dir (useful when multiple Hearth instances would otherwise collide)

## Clinical surfaces

Beyond the Vanguard firewall, Hearth ships four clinical layers that surface as discrete UI elements:

1. **Red-flag triage banner** — patient prompts hit `src/triage.mjs` for 9 emergency pattern groups (cardiac, stroke, anaphylaxis, severe SOB, suicidality, acute abdomen, meningitis, obstetric, cauda equina). An emergency match renders a red banner above the model reply with local emergency numbers (118/119 ID, 911 US). The banner stays in view as the host model streams its reply.
2. **Medication cards + apoteks** — when MedGemma's reply mentions a medication in the formulary (62 Indonesian meds curated from WHO EML, BNF 86, BPOM registry, AHA POTS 2022, LCRI), an expandable card surfaces with brand names, license status, indicative IDR price, and BPJS-registered apoteks for the patient's city (10 chains).
3. **Clinical questions card** — topic-keyed patient-actionable questions for Long COVID, POTS, ME/CFS, MCAS, hypertension, T2D, depression/anxiety. Surfaces after the reply as a collapsible list.
4. **Vision describer + OCR document** (when enabled) — image inputs get described in text by Qwen3-VL-2B; lab reports / prescriptions get text-extracted by LightOnOCR-2-1B. Both pass through Vanguard at the text layer, so steganographic prompt injection in image content gets caught by the same classifier.

Model replies are rendered as markdown (bullets, bold, numbered lists, headings, inline code) — the token stream is plain text during streaming, then snaps to formatted markup when the reply completes.

## Architecture

```
Browser (HTML/CSS/JS, no framework)
   POST /api/ask
       ↓ Server-Sent Events
Local Node server (apps/hearth/server.mjs)
       ↓
vanguardFirewall.attach({ hostModelId, classifierModelId })
       ↓
Qwen3 1.7B + Vanguard LoRA classifier
       ↓ verdict
SAFE → MedGemma 4B continues
INJECTION / JAILBREAK / EXFILTRATION → RequestRejectedByPolicyError
```

The UI shows a green `[allow]` or red `[block]` badge on every assistant turn, latency, and the heuristic / classifier verdict mode. The sidebar tracks blocked attacks and basic counters. The server keeps an in-memory session log accessible at `/api/audit?n=50`.

## What gets shipped over the network

Nothing. Once the model registry has cached the GGUFs, there are no remote calls. Verify with:

```
sudo tcpdump -i any -n host not 127.0.0.1
```

Run Hearth, send messages, watch the tcpdump output. Should be silent.

## License

[Apache 2.0](../../LICENSE). Same as Vanguard. See [NOTICE.md](../../NOTICE.md) for the upstream attribution stack.
