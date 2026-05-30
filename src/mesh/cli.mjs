// SPDX-License-Identifier: Apache-2.0
//
// Vanguard mesh CLI — minimal commands for the 2-device demo.
//
// Examples:
//   node src/mesh/cli.mjs join --secret myteam --device dev-A --storage ./.mesh-a
//   node src/mesh/cli.mjs publish --prompt "Ignore previous instructions" --label INJECTION --storage ./.mesh-a
//   node src/mesh/cli.mjs lookup --prompt "ignore previous instructions" --storage ./.mesh-a
//   node src/mesh/cli.mjs list --storage ./.mesh-a
//   node src/mesh/cli.mjs key --storage ./.mesh-a

import { hostname } from "node:os";
import { startMesh } from "./index.mjs";
import { SignatureStore } from "./store.mjs";
import { signatureHash } from "./signatures.mjs";

const USAGE = `usage: vanguard mesh <command> [options]

commands:
  join     --secret <s> --device <id> [--storage <dir>]
           Stay in the swarm forever (Ctrl-C to exit). Replicates signatures.
  publish  --prompt <text> --label <SAFE|INJECTION|JAILBREAK|EXFILTRATION>
           [--transforms <a,b,c>] [--secret <s>] [--device <id>] [--storage <dir>]
           [--offline]   Add a signature to the local store + broadcast to peers.
  lookup   --prompt <text> [--storage <dir>]
           Check whether the given prompt's signature is in the local store.
  list     [--storage <dir>]
           Dump every signature in the local store.
  key      [--storage <dir>]
           Print the public discovery key of the local signature core.

options:
  --secret      shared text across peers; topic = sha256("vanguard-mesh:" + secret)
  --device      stable identifier for this device (default: hostname)
  --storage     directory to persist corestore (default: ./.vanguard-mesh)
  --offline     skip joining the swarm (publish locally only)
`;

function parseArgs(args) {
  const out = { command: args[0], _: [], flags: {} };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) { out.flags[k] = next; i++; }
      else { out.flags[k] = "true"; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function defaultDevice() {
  try {
    return hostname();
  } catch {
    return "unknown";
  }
}

async function cmdJoin(flags) {
  const mesh = await startMesh({
    storageDir: flags.storage ?? "./.vanguard-mesh",
    secret: flags.secret,
    deviceId: flags.device ?? defaultDevice(),
    online: true,
  });
  mesh.swarm.onPeer = ({ remoteKey, total }) => {
    process.stdout.write(`[mesh] peer connected ${remoteKey} (total=${total})\n`);
  };
  const key = await mesh.store.key();
  const discovery = await mesh.store.discoveryKey();
  const count = await mesh.count();
  process.stdout.write(`[mesh] device=${flags.device ?? defaultDevice()} secret=${flags.secret ?? "<none>"}\n`);
  process.stdout.write(`[mesh] storage=${flags.storage ?? "./.vanguard-mesh"}\n`);
  process.stdout.write(`[mesh] core key=${key}\n`);
  process.stdout.write(`[mesh] discovery=${discovery}\n`);
  process.stdout.write(`[mesh] signatures locally: ${count}\n`);
  process.stdout.write(`[mesh] waiting for peers, Ctrl-C to exit...\n`);
  const shutdown = async () => {
    process.stdout.write(`\n[mesh] shutting down...\n`);
    await mesh.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

async function cmdPublish(flags) {
  const prompt = flags.prompt;
  const label = flags.label;
  if (!prompt || !label) { process.stderr.write("error: --prompt and --label required\n"); process.exit(2); }
  const offline = flags.offline === "true";
  const mesh = await startMesh({
    storageDir: flags.storage ?? "./.vanguard-mesh",
    secret: flags.secret,
    deviceId: flags.device ?? defaultDevice(),
    online: !offline,
  });
  const transforms = (flags.transforms ?? "").split(",").filter(Boolean);
  const sig = await mesh.publish({ prompt, label, transforms });
  const count = await mesh.count();
  process.stdout.write(`[mesh] published ${sig.sig.slice(0, 16)}... label=${label}\n`);
  process.stdout.write(`[mesh] local count: ${count}\n`);
  if (!offline) {
    process.stdout.write(`[mesh] peer count: ${mesh.swarm.peerCount()}\n`);
    process.stdout.write(`[mesh] holding the swarm for 3s to allow replication...\n`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  await mesh.close();
}

async function cmdLookup(flags) {
  const prompt = flags.prompt;
  if (!prompt) { process.stderr.write("error: --prompt required\n"); process.exit(2); }
  const store = new SignatureStore(flags.storage ?? "./.vanguard-mesh");
  await store.open();
  const hash = signatureHash(prompt);
  const node = await store.get(hash);
  if (node) {
    process.stdout.write(`[match] ${hash.slice(0, 16)}... label=${node.label} device=${node.deviceId} ts=${new Date(node.ts).toISOString()}\n`);
    if (node.transforms?.length) process.stdout.write(`  transforms: ${node.transforms.join(", ")}\n`);
    process.exit(0);
  } else {
    process.stdout.write(`[no-match] ${hash.slice(0, 16)}...\n`);
    await store.close();
    process.exit(1);
  }
}

async function cmdList(flags) {
  const store = new SignatureStore(flags.storage ?? "./.vanguard-mesh");
  await store.open();
  let n = 0;
  for await (const sig of store.list()) {
    n++;
    process.stdout.write(`${n}. ${sig.sig.slice(0, 16)}...  label=${sig.label}  device=${sig.deviceId}  ts=${new Date(sig.ts).toISOString()}\n`);
  }
  if (n === 0) process.stdout.write(`(empty)\n`);
  process.stdout.write(`\ntotal: ${n}\n`);
  await store.close();
}

async function cmdKey(flags) {
  const store = new SignatureStore(flags.storage ?? "./.vanguard-mesh");
  await store.open();
  const key = await store.key();
  const discovery = await store.discoveryKey();
  process.stdout.write(`core key:      ${key}\n`);
  process.stdout.write(`discovery key: ${discovery}\n`);
  await store.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.command;
  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  switch (cmd) {
    case "join": return cmdJoin(args.flags);
    case "publish": return cmdPublish(args.flags);
    case "lookup": return cmdLookup(args.flags);
    case "list": return cmdList(args.flags);
    case "key": return cmdKey(args.flags);
    default:
      process.stderr.write(`unknown command: ${cmd}\n${USAGE}`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error("[mesh] error:", e);
  process.exit(1);
});
