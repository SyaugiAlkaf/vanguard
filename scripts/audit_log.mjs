// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = '1.0.0';

function nowIso() {
  return new Date().toISOString();
}

function sha256(input) {
  return createHash('sha256').update(input ?? '', 'utf8').digest('hex');
}

function writeLine(state, entry) {
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(state.path, line, { encoding: 'utf8' });
}

export function openAuditLog(path) {
  if (!path || typeof path !== 'string') {
    throw new TypeError('openAuditLog: path must be a non-empty string');
  }
  const dir = dirname(path);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const state = { path, sessionId: sha256(`${nowIso()}-${process.pid}-${Math.random()}`).slice(0, 16) };

  writeLine(state, {
    schema_version: SCHEMA_VERSION,
    event: 'session_start',
    timestamp: nowIso(),
    session_id: state.sessionId,
    pid: process.pid,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
  });

  return {
    path,
    sessionId: state.sessionId,
    recordModelLoad: (args) => recordModelLoad(state, args),
    recordModelUnload: (args) => recordModelUnload(state, args),
    recordInference: (args) => recordInference(state, args),
    close: () => {
      writeLine(state, {
        schema_version: SCHEMA_VERSION,
        event: 'session_end',
        timestamp: nowIso(),
        session_id: state.sessionId,
      });
    },
  };
}

export function recordModelLoad(state, { modelId, modelType, src, deviceInfo } = {}) {
  const entry = {
    schema_version: SCHEMA_VERSION,
    event: 'model_load',
    timestamp: nowIso(),
    session_id: state.sessionId,
    model_id: String(modelId ?? ''),
    model_type: String(modelType ?? ''),
    src: String(src ?? ''),
    device_info: deviceInfo ?? null,
  };
  writeLine(state, entry);
  return entry;
}

export function recordModelUnload(state, { modelId } = {}) {
  const entry = {
    schema_version: SCHEMA_VERSION,
    event: 'model_unload',
    timestamp: nowIso(),
    session_id: state.sessionId,
    model_id: String(modelId ?? ''),
  };
  writeLine(state, entry);
  return entry;
}

export function recordInference(state, {
  modelId,
  prompt,
  completion,
  promptTokens,
  completionTokens,
  ttftMs,
  tps,
  classifierVerdict,
  classifierConfidence,
  blocked,
  errorReason,
} = {}) {
  const entry = {
    schema_version: SCHEMA_VERSION,
    event: 'inference',
    timestamp: nowIso(),
    session_id: state.sessionId,
    model_id: String(modelId ?? ''),
    prompt_sha256: sha256(prompt),
    prompt_length_chars: typeof prompt === 'string' ? prompt.length : 0,
    completion_sha256: sha256(completion),
    completion_length_chars: typeof completion === 'string' ? completion.length : 0,
    prompt_tokens: Number(promptTokens ?? 0),
    completion_tokens: Number(completionTokens ?? 0),
    ttft_ms: Number(ttftMs ?? 0),
    tps: Number(tps ?? 0),
    classifier_verdict: classifierVerdict ?? null,
    classifier_confidence: classifierConfidence == null ? null : Number(classifierConfidence),
    blocked: Boolean(blocked),
    error_reason: errorReason ?? null,
  };
  writeLine(state, entry);
  return entry;
}

export { SCHEMA_VERSION, sha256 };
