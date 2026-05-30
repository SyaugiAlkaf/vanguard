// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadavg, freemem, totalmem, cpus, hostname, platform } from 'node:os';

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_DURATION_S = 600;

function parseArgs(argv) {
  const args = { output: 'artifacts/resource_log.jsonl', duration: DEFAULT_DURATION_S, interval: DEFAULT_INTERVAL_MS / 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a === '--duration' || a === '-d') args.duration = Number(argv[++i]);
    else if (a === '--interval' || a === '-i') args.interval = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/resource_log.mjs [--output PATH] [--duration SECONDS] [--interval SECONDS]');
      process.exit(0);
    }
  }
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  const d = dirname(p);
  if (d && !existsSync(d)) mkdirSync(d, { recursive: true });
}

function topSampleCpuPercent() {
  try {
    const r = spawnSync('top', ['-l', '1', '-n', '0', '-stats', 'cpu'], { encoding: 'utf8', timeout: 1500 });
    if (r.status !== 0 || !r.stdout) return null;
    const line = r.stdout.split('\n').find((l) => l.startsWith('CPU usage:'));
    if (!line) return null;
    const m = line.match(/([\d.]+)%\s*user.*?([\d.]+)%\s*sys.*?([\d.]+)%\s*idle/);
    if (!m) return null;
    const user = Number(m[1]);
    const sys = Number(m[2]);
    const idle = Number(m[3]);
    return { user, sys, idle, busy: Number((100 - idle).toFixed(2)) };
  } catch {
    return null;
  }
}

function startPowermetricsGpu() {
  if (platform() !== 'darwin') return { latest: () => null, stop: () => {} };
  let latest = null;
  let child;
  try {
    child = spawn('sudo', ['-n', 'powermetrics', '--samplers', 'gpu_power', '-i', '1000', '-f', 'plist'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return { latest: () => null, stop: () => {} };
  }

  let permDenied = false;
  child.stderr?.on('data', (buf) => {
    const s = buf.toString();
    if (/password|sudo|a terminal is required|not allowed/i.test(s)) {
      permDenied = true;
    }
  });

  let buffer = '';
  child.stdout?.on('data', (buf) => {
    buffer += buf.toString();
    const matches = [...buffer.matchAll(/<key>GPU\s*Active\s*Frequency<\/key>[^<]*<real>([\d.]+)<\/real>/gi)];
    if (matches.length > 0) {
      latest = { gpu_active_freq_hz: Number(matches[matches.length - 1][1]) };
    }
    const busy = [...buffer.matchAll(/<key>GPU\s*Active\s*Residency<\/key>[^<]*<real>([\d.]+)<\/real>/gi)];
    if (busy.length > 0) {
      latest = { ...(latest ?? {}), gpu_active_pct: Number(Number(busy[busy.length - 1][1]).toFixed(2)) };
    }
    if (buffer.length > 1_000_000) buffer = buffer.slice(-200_000);
  });

  child.on('error', () => { permDenied = true; });

  return {
    latest: () => (permDenied ? null : latest),
    stop: () => { try { child?.kill('SIGTERM'); } catch {} },
    isPermDenied: () => permDenied,
  };
}

function snapshot(gpuSource) {
  const cpu = topSampleCpuPercent();
  const free = freemem();
  const total = totalmem();
  const la = loadavg();
  const gpu = gpuSource.latest();

  return {
    schema_version: SCHEMA_VERSION,
    event: 'resource_sample',
    timestamp: nowIso(),
    loadavg_1m: Number(la[0].toFixed(2)),
    loadavg_5m: Number(la[1].toFixed(2)),
    loadavg_15m: Number(la[2].toFixed(2)),
    cpu_logical_count: cpus().length,
    cpu_busy_pct: cpu?.busy ?? null,
    cpu_user_pct: cpu?.user ?? null,
    cpu_sys_pct: cpu?.sys ?? null,
    cpu_idle_pct: cpu?.idle ?? null,
    mem_total_mb: Number((total / 1024 / 1024).toFixed(0)),
    mem_free_mb: Number((free / 1024 / 1024).toFixed(0)),
    mem_used_pct: Number((((total - free) / total) * 100).toFixed(2)),
    gpu_active_pct: gpu?.gpu_active_pct ?? null,
    gpu_active_freq_hz: gpu?.gpu_active_freq_hz ?? null,
    gpu_source: gpu ? 'powermetrics' : 'unavailable',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.output);

  const intervalMs = Math.max(250, args.interval * 1000);
  const durationMs = Math.max(intervalMs, args.duration * 1000);
  const deadline = Date.now() + durationMs;

  const gpuSource = startPowermetricsGpu();

  appendFileSync(args.output, JSON.stringify({
    schema_version: SCHEMA_VERSION,
    event: 'resource_log_start',
    timestamp: nowIso(),
    hostname: hostname(),
    platform: platform(),
    cpu_logical_count: cpus().length,
    mem_total_mb: Number((totalmem() / 1024 / 1024).toFixed(0)),
    interval_ms: intervalMs,
    duration_ms: durationMs,
    output: args.output,
  }) + '\n');

  let stopping = false;
  const shutdown = (sig) => {
    if (stopping) return;
    stopping = true;
    gpuSource.stop();
    appendFileSync(args.output, JSON.stringify({
      schema_version: SCHEMA_VERSION,
      event: 'resource_log_end',
      timestamp: nowIso(),
      reason: sig ?? 'completed',
      gpu_perm_denied: gpuSource.isPermDenied?.() ?? false,
    }) + '\n');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (!stopping && Date.now() < deadline) {
    try {
      const entry = snapshot(gpuSource);
      appendFileSync(args.output, JSON.stringify(entry) + '\n');
    } catch (err) {
      appendFileSync(args.output, JSON.stringify({
        schema_version: SCHEMA_VERSION,
        event: 'resource_sample_error',
        timestamp: nowIso(),
        error: String(err?.message ?? err),
      }) + '\n');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  shutdown('completed');
}

main().catch((err) => {
  console.error('resource_log fatal:', err);
  process.exit(1);
});
