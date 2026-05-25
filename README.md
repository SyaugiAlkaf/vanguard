# Vanguard

> **Prompt injection ends here.**
> Sovereign firewall for local LLMs. No cloud. No captivity.

Vanguard is an on-device prompt-injection firewall and threat detector for local LLMs. It sits in front of your inference call, classifies every prompt, blocks jailbreaks and exfiltration attempts before the model sees them, and learns from new attacks via on-device LoRA fine-tuning. Threat signatures sync between your own devices over Hyperswarm — no central server, no telemetry, no captivity.

Built on the [QVAC SDK](https://qvac.tether.io) for the [QVAC Hackathon I — Unleash Edge AI](https://dorahacks.io/hackathon/qvac-unleach-edge-ai-i).

---

## Status

Work in progress. Pre-MVP. Submitting to QVAC Hackathon I (deadline 2026-06-21).

## Why

Every other local-LLM project ships defenseless. Drop a hostile prompt into Llama running on a laptop and it leaks SSH keys, reveals system prompts, or executes attacker-controlled tool calls. Cloud LLM firewalls (Lakera, Prompt Shield, LlamaGuard) exist — but the moment you put your AI on your own hardware for sovereignty reasons, you also lose the safety layer.

Vanguard is the safety layer for sovereign AI.

## How it works

Four agents working over QVAC SDK primitives:

1. **Classifier** — a LoRA-fine-tuned detector identifies injection, jailbreak, and exfiltration patterns
2. **Sandboxer** — suspicious prompts run through a constrained simulation before reaching the host model
3. **Signature broadcaster** — when a novel attack class is detected, the signature propagates via Hyperswarm to all your devices
4. **Red-team agent** — adversarially generates new attack candidates locally; the classifier learns from them via on-device LoRA

The wrapper SDK exposes a drop-in `safeCompletion()` API. Existing QVAC SDK consumers replace `completion()` with `safeCompletion()` and inherit Vanguard's protections.

## Reproducibility

To be filled in before submission. Includes:
- Hardware specs (CPU / GPU / RAM / storage) + screenshots of system profiler
- Setup instructions runnable on declared hardware out of the box
- Audit log format (model loads/unloads, prompt, tokens, TTFT, tokens/sec)
- Timestamped system resource log matching the demo video
- Attack corpus references (Lakera, PromptBench, Garak)
- LoRA training script + base model + adapter weights

## Track

**General Purpose devices** (≤ 32 GB RAM laptops/desktops). Potentially also **Psy Models** if MedPsy serves as the detector base.

## License

[Apache License 2.0](LICENSE).

## Author

Syaugi — solo entry.
