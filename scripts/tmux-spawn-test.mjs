#!/usr/bin/env node
/**
 * tmux-spawn-test.mjs — Standalone test for tmux session spawn reliability.
 * 
 * Tests rapid sequential tmux session creation to reproduce the startup crash
 * pattern (#335) without running a full batch.
 * 
 * Usage:
 *   node scripts/tmux-spawn-test.mjs [--rounds 10] [--delay 0] [--command "echo hello"] [--wait-after 300]
 * 
 * Options:
 *   --rounds N       Number of create/destroy cycles (default: 20)
 *   --delay N        Milliseconds between destroy and next create (default: 0)
 *   --wait-after N   Milliseconds to wait after create before checking (default: 300)
 *   --command CMD    Command to run in the tmux session (default: "sleep 10")
 *   --pi             Use actual rpc-wrapper + pi command (expensive! uses tokens)
 *   --verbose        Show detailed output
 */

import { spawnSync } from "child_process";
import { resolve, join } from "path";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultVal;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(name);

const ROUNDS = parseInt(getArg("--rounds", "20"), 10);
const DELAY_MS = parseInt(getArg("--delay", "0"), 10);
const WAIT_AFTER_MS = parseInt(getArg("--wait-after", "300"), 10);
const COMMAND = getArg("--command", "sleep 10");
const USE_PI = hasFlag("--pi");
const VERBOSE = hasFlag("--verbose");

const SESSION_NAME = "tp-spawn-test";

function sleep(ms) {
  if (ms <= 0) return;
  spawnSync("sleep", [`${ms / 1000}`], { shell: true });
}

function killSession() {
  spawnSync("tmux", ["kill-session", "-t", SESSION_NAME]);
}

function hasSession() {
  const r = spawnSync("tmux", ["has-session", "-t", SESSION_NAME]);
  return r.status === 0;
}

function createSession(cmd) {
  const r = spawnSync("tmux", ["new-session", "-d", "-s", SESSION_NAME, cmd]);
  return { ok: r.status === 0, stderr: r.stderr?.toString().trim() || "" };
}

// Build the pi command if --pi flag is set
function buildPiCommand() {
  const rpcWrapper = resolve("bin/rpc-wrapper.mjs");
  const sidecarDir = join(tmpdir(), "tp-spawn-test");
  mkdirSync(sidecarDir, { recursive: true });
  const sidecarPath = join(sidecarDir, "test-sidecar.jsonl");
  const exitPath = join(sidecarDir, "test-exit.json");
  const sysPrompt = join(tmpdir(), "tp-spawn-test-sys.txt");
  const promptFile = join(tmpdir(), "tp-spawn-test-prompt.txt");
  writeFileSync(sysPrompt, "You are a test. Reply with 'hello' then exit.");
  writeFileSync(promptFile, "Say hello.");
  
  return [
    `TERM=xterm-256color node`,
    `'${rpcWrapper}'`,
    `--sidecar-path '${sidecarPath}'`,
    `--exit-summary-path '${exitPath}'`,
    `--model anthropic/claude-sonnet-4-20250514`,
    `--system-prompt-file '${sysPrompt}'`,
    `--prompt-file '${promptFile}'`,
    `--tools read,bash`,
    `-- --thinking off --no-extensions --no-skills`,
  ].join(" ");
}

// ── Main test loop ──────────────────────────────────────────────────

console.log(`\n🧪 tmux spawn reliability test`);
console.log(`   Rounds: ${ROUNDS}`);
console.log(`   Delay between cycles: ${DELAY_MS}ms`);
console.log(`   Wait after create: ${WAIT_AFTER_MS}ms`);
console.log(`   Command: ${USE_PI ? "rpc-wrapper + pi" : COMMAND}`);
console.log();

// Ensure clean start
killSession();

const results = { success: 0, fail: 0, createFail: 0, times: [] };
const cmd = USE_PI ? buildPiCommand() : COMMAND;

for (let i = 0; i < ROUNDS; i++) {
  const t0 = Date.now();
  
  // Create session
  const { ok, stderr } = createSession(cmd);
  if (!ok) {
    results.createFail++;
    console.log(`  Round ${i + 1}: ❌ tmux create failed: ${stderr}`);
    sleep(DELAY_MS);
    continue;
  }
  
  // Wait for session to stabilize
  sleep(WAIT_AFTER_MS);
  
  // Check if session is alive
  const alive = hasSession();
  const elapsed = Date.now() - t0;
  results.times.push(elapsed);
  
  if (alive) {
    results.success++;
    if (VERBOSE) console.log(`  Round ${i + 1}: ✅ alive (${elapsed}ms)`);
  } else {
    results.fail++;
    console.log(`  Round ${i + 1}: ❌ died within ${WAIT_AFTER_MS}ms (${elapsed}ms total)`);
  }
  
  // Cleanup
  killSession();
  sleep(DELAY_MS);
}

// ── Results ──────────────────────────────────────────────────────────

const pct = ((results.success / ROUNDS) * 100).toFixed(1);
const avgMs = results.times.length > 0
  ? (results.times.reduce((a, b) => a + b, 0) / results.times.length).toFixed(0)
  : "N/A";

console.log();
console.log(`📊 Results:`);
console.log(`   Success: ${results.success}/${ROUNDS} (${pct}%)`);
console.log(`   Died on startup: ${results.fail}`);
console.log(`   Create failed: ${results.createFail}`);
console.log(`   Avg cycle time: ${avgMs}ms`);

if (results.fail > 0) {
  console.log();
  console.log(`💡 Suggestions:`);
  console.log(`   Try increasing --wait-after (current: ${WAIT_AFTER_MS}ms)`);
  console.log(`   Try increasing --delay (current: ${DELAY_MS}ms)`);
  console.log(`   Example: node scripts/tmux-spawn-test.mjs --delay 500 --wait-after 1000`);
}

// ── Sweep test: find the minimum delay for 100% success ──────────

if (hasFlag("--sweep")) {
  console.log();
  console.log(`\n🔍 Delay sweep (finding minimum reliable delay)...`);
  const SWEEP_ROUNDS = 10;
  
  for (const delay of [0, 100, 200, 500, 1000, 2000]) {
    let ok = 0;
    for (let i = 0; i < SWEEP_ROUNDS; i++) {
      killSession();
      sleep(delay);
      createSession(COMMAND);
      sleep(WAIT_AFTER_MS);
      if (hasSession()) ok++;
      killSession();
    }
    const rate = ((ok / SWEEP_ROUNDS) * 100).toFixed(0);
    const icon = ok === SWEEP_ROUNDS ? "✅" : ok > SWEEP_ROUNDS / 2 ? "⚠️" : "❌";
    console.log(`   ${icon} delay=${delay}ms: ${ok}/${SWEEP_ROUNDS} (${rate}%)`);
    if (ok === SWEEP_ROUNDS) {
      console.log(`   → Minimum reliable delay: ${delay}ms`);
      break;
    }
  }
}

process.exit(results.fail > 0 ? 1 : 0);
