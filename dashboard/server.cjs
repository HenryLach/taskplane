#!/usr/bin/env node
/**
 * Orchestrator Web Dashboard — Local HTTP server with SSE live updates.
 *
 * Reads .pi/batch-state.json + STATUS.md files and streams state to the
 * browser via Server-Sent Events. Zero external dependencies.
 *
 * Usage:
 *   node dashboard/server.cjs [--port 8099] [--root /path/to/project]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
// url module not needed — we parse with new URL() below

// ─── Configuration ──────────────────────────────────────────────────────────

const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_PORT = 8100;
const MAX_PORT_ATTEMPTS = 20;
const POLL_INTERVAL = 2000; // ms between state checks

// REPO_ROOT is resolved after parseArgs() — see initialization below.
// In workspace mode, REPO_ROOT is the workspace root (passed via --root).
// All dashboard state paths (batch-state, lane-state, conversation logs,
// batch-history) live at <REPO_ROOT>/.pi/ — this is runtime/sidecar state
// which does NOT follow the taskplane-pointer.json resolution chain.
// The pointer directs config/agent lookups to a config repo, but the
// dashboard only reads state files, so no pointer resolution is needed here.
let REPO_ROOT;
let BATCH_STATE_PATH;
let BATCH_HISTORY_PATH;

// ─── CLI Args ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: DEFAULT_PORT, open: true, root: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      opts.port = parseInt(args[i + 1]) || DEFAULT_PORT;
      i++;
    } else if (args[i] === "--root" && args[i + 1]) {
      opts.root = args[i + 1];
      i++;
    } else if (args[i] === "--no-open") {
      opts.open = false;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Orchestrator Web Dashboard

Usage:
  node dashboard/server.cjs [options]

Options:
  --port <number>   Port to listen on (default: ${DEFAULT_PORT})
  --root <path>     Project root directory (default: current directory)
  --no-open         Don't auto-open browser
  -h, --help        Show this help
`);
      process.exit(0);
    }
  }
  return opts;
}

// ─── Data Loading (ported from orch-dashboard.cjs) ──────────────────────────

function normalizeBatchStateIngress(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.lanes)) {
    return state;
  }

  for (const lane of state.lanes) {
    if (!lane || typeof lane !== "object") continue;
    const laneSessionId = typeof lane.laneSessionId === "string"
      ? lane.laneSessionId
      : (typeof lane.tmuxSessionName === "string" ? lane.tmuxSessionName : undefined);
    if (laneSessionId) {
      lane.laneSessionId = laneSessionId;
    }
    if ("tmuxSessionName" in lane) {
      delete lane.tmuxSessionName;
    }
  }

  return state;
}

function loadBatchState() {
  try {
    const raw = fs.readFileSync(BATCH_STATE_PATH, "utf-8");
    return normalizeBatchStateIngress(JSON.parse(raw));
  } catch {
    return null;
  }
}

function resolveTaskFolder(task, state) {
  if (!task || !task.taskFolder) return null;
  const laneNum = task.laneNumber;
  const lane = (state?.lanes || []).find((l) => l.laneNumber === laneNum);
  if (!lane || !lane.worktreePath) return task.taskFolder;

  // In workspace mode, the worktree is inside a specific repo, not the workspace root.
  // The task folder path needs to be made relative to the repo root (parent of the worktree),
  // not the workspace root. Detect this by finding the repo root from the worktree path.
  const taskFolderAbs = path.resolve(task.taskFolder);
  const worktreeAbs = path.resolve(lane.worktreePath);

  // Try to find the repo root: walk up from the worktree path looking for which
  // ancestor is a prefix of the task folder. The worktree is at <repoRoot>/.worktrees/<name>
  // or a sibling, so the repo root is typically 2 levels up from a subdirectory worktree.
  // Heuristic: find the longest common ancestor between taskFolder and worktree's repo root.
  const repoRootAbs = path.resolve(REPO_ROOT);

  // First try: relative to workspace root (works in repo mode where workspace = repo)
  let rel = path.relative(repoRootAbs, taskFolderAbs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return task.taskFolder;

  // Check if joining with worktree produces a valid path
  const candidate = path.join(worktreeAbs, rel);
  try {
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* fall through */ }

  // Second try: the worktree is inside a repo subdirectory of the workspace root.
  // Strip the repo prefix from the task folder path to get the repo-relative path.
  // e.g., taskFolder = "workspace/platform-docs/task-mgmt/DOC-001/"
  //        worktree  = "workspace/platform-docs/.worktrees/wt-1/"
  //        repo-relative = "task-mgmt/DOC-001/"
  // Find the repo by checking which workspace repo path is a prefix of the task folder.
  const repoRoots = [];
  try {
    const stateMode = state.mode;
    if (stateMode === "workspace" && state.repos) {
      for (const r of state.repos) repoRoots.push(path.resolve(r.path));
    }
  } catch { /* no repo info in state */ }

  // Also try inferring repo root from worktree path pattern:
  // .worktrees/<name> → parent is repo root; sibling worktrees → shared parent
  const worktreeParent = path.dirname(worktreeAbs);
  const worktreeGrandparent = path.dirname(worktreeParent);
  for (const possibleRepoRoot of [worktreeGrandparent, ...repoRoots]) {
    const repoRel = path.relative(possibleRepoRoot, taskFolderAbs);
    if (repoRel && !repoRel.startsWith("..") && !path.isAbsolute(repoRel)) {
      const repoCandidate = path.join(worktreeAbs, repoRel);
      try {
        if (fs.existsSync(repoCandidate)) return repoCandidate;
      } catch { continue; }
    }
  }

  // Fallback: return original task folder (might work if not in worktree)
  return task.taskFolder;
}

function parseStatusMd(taskFolder) {
  const candidates = [taskFolder];
  const taskId = path.basename(taskFolder);
  const archiveBase = taskFolder.replace(/[/\\]tasks[/\\][^/\\]+$/, "/tasks/archive/" + taskId);
  if (archiveBase !== taskFolder) candidates.push(archiveBase);

  for (const folder of candidates) {
    const statusPath = path.join(folder, "STATUS.md");
    try {
      const content = fs.readFileSync(statusPath, "utf-8");
      const stepMatch = content.match(/\*\*Current Step:\*\*\s*(.+)/);
      const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)/);
      const iterMatch = content.match(/\*\*Iteration:\*\*\s*(\d+)/);
      const reviewMatch = content.match(/\*\*Review Counter:\*\*\s*(\d+)/);
      const checked = (content.match(/- \[x\]/gi) || []).length;
      const unchecked = (content.match(/- \[ \]/g) || []).length;
      const total = checked + unchecked;
      return {
        currentStep: stepMatch ? stepMatch[1].trim() : "Unknown",
        status: statusMatch ? statusMatch[1].trim() : "Unknown",
        iteration: iterMatch ? parseInt(iterMatch[1]) : 0,
        reviews: reviewMatch ? parseInt(reviewMatch[1]) : 0,
        checked,
        total,
        progress: total > 0 ? Math.round((checked / total) * 100) : 0,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function getTmuxSessions() {
  // Runtime V2 no longer relies on TMUX sessions.
  // Keep field shape stable for dashboard clients that still read `tmuxSessions`.
  return [];
}

function checkDoneFile(taskFolder) {
  const candidates = [taskFolder];
  const taskId = path.basename(taskFolder);
  const archiveBase = taskFolder.replace(/[/\\]tasks[/\\][^/\\]+$/, "/tasks/archive/" + taskId);
  if (archiveBase !== taskFolder) candidates.push(archiveBase);
  for (const folder of candidates) {
    if (fs.existsSync(path.join(folder, ".DONE"))) return true;
  }
  return false;
}

/** Read lane state sidecar JSON files written by the task-runner. */
function loadLaneStates() {
  const piDir = path.join(REPO_ROOT, ".pi");
  const states = {};
  try {
    const files = fs.readdirSync(piDir).filter(f => f.startsWith("lane-state-") && f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(piDir, file), "utf-8").trim();
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (data.prefix) states[data.prefix] = data;
      } catch { continue; }
    }
  } catch { /* .pi dir may not exist */ }
  return states;
}

// ─── Telemetry JSONL Tailing ────────────────────────────────────────────────

/**
 * Module-level tail state for incremental JSONL reading.
 * Persists across poll ticks within this server process.
 * Key: absolute file path → { offset, partial }
 */
const telemetryTailStates = new Map();

/**
 * Module-level accumulated telemetry per tmux prefix.
 * Persists across poll ticks so incremental tail reads accumulate correctly.
 * Key: tmux prefix → { inputTokens, outputTokens, ... }
 */
const telemetryAccumulators = new Map();

/**
 * Tracks which files are currently contributing to each prefix.
 * Key: tmux prefix → Set of absolute file paths
 * Used to detect file rotation: when files change, accumulator is reset.
 */
const telemetryPrefixFiles = new Map();

/**
 * Parse a telemetry JSONL filename to extract lane number and role.
 * Pattern: {opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.jsonl
 * Roles: worker, reviewer, merger
 * Returns { laneNumber: number|null, role: string, mergeNumber: number|null } or null if unparseable.
 */
function parseTelemetryFilename(filename) {
  // Remove .jsonl extension
  const base = filename.replace(/\.jsonl$/, "");
  // Role is always the last segment
  const lastDash = base.lastIndexOf("-");
  if (lastDash < 0) return null;
  const role = base.slice(lastDash + 1);
  if (role !== "worker" && role !== "reviewer" && role !== "merger") return null;

  // Extract lane number from -lane-{N}- pattern
  const laneMatch = base.match(/-lane-(\d+)-/);
  const laneNumber = laneMatch ? parseInt(laneMatch[1], 10) : null;

  // Extract merge number from -merge-{N}- pattern (merge agents)
  const mergeMatch = base.match(/-merge-(\d+)-/);
  const mergeNumber = mergeMatch ? parseInt(mergeMatch[1], 10) : null;

  return { laneNumber, role, mergeNumber };
}

/**
 * Incrementally read new bytes from a JSONL file, parse events, and return them.
 * Handles: file not yet created, empty reads, partial trailing lines, malformed JSON.
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {object[]} Array of parsed event objects from new data
 */
function tailJsonlFile(filePath) {
  // Get or create tail state for this file
  let tailState = telemetryTailStates.get(filePath);
  if (!tailState) {
    tailState = { offset: 0, partial: "" };
    telemetryTailStates.set(filePath, tailState);
  }

  // Check file size
  let fileSize;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch {
    return []; // File doesn't exist yet
  }

  // Handle file truncation/recreation (offset beyond current size)
  if (fileSize < tailState.offset) {
    tailState.offset = 0;
    tailState.partial = "";
    tailState.wasReset = true; // Signal to caller that accumulator should be reset
  }

  if (fileSize <= tailState.offset) {
    return []; // No new data
  }

  // Cap read size per tick to avoid ERR_STRING_TOO_LONG on large files.
  // If there's more data remaining, the next SSE tick will pick up the rest.
  const MAX_TAIL_BYTES = 10 * 1024 * 1024; // 10 MB per tick

  // Skip-to-tail on fresh dashboard start with large files.
  // The partial-line handling below already discards the first partial line.
  if (tailState.offset === 0 && fileSize > MAX_TAIL_BYTES) {
    tailState.offset = fileSize - MAX_TAIL_BYTES;
  }

  // Read new bytes from offset, capped to MAX_TAIL_BYTES
  const bytesToRead = Math.min(fileSize - tailState.offset, MAX_TAIL_BYTES);
  const buf = Buffer.alloc(bytesToRead);
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return []; // File became inaccessible
  }
  try {
    fs.readSync(fd, buf, 0, bytesToRead, tailState.offset);
  } catch {
    fs.closeSync(fd);
    return []; // Read error — try again next tick
  }
  fs.closeSync(fd);
  tailState.offset += bytesToRead;

  // Split into lines, preserving partial trailing line
  const chunk = tailState.partial + buf.toString("utf-8");
  const lines = chunk.split("\n");
  tailState.partial = lines.pop() || "";

  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && event.type) events.push(event);
    } catch {
      // Malformed JSON — skip (concurrent write race, truncated line)
    }
  }
  return events;
}

/**
 * Load and accumulate telemetry from .pi/telemetry/*.jsonl files.
 * Returns telemetry keyed by session prefix (e.g., "orch-lane-1").
 *
 * Uses batch-state lanes to map lane numbers → session prefixes.
 * For standalone /task mode (no lane number in filename), data is keyed as "standalone".
 *
 * @param {object|null} batchState - The batch state from batch-state.json
 * @returns {object} Map of sessionPrefix → accumulated telemetry
 */

// ── Runtime V2 Data Loaders (TP-107) ─────────────────────────────

/**
 * Load the Runtime V2 process registry for the current batch.
 * Returns null if no registry exists (legacy batch).
 */
function loadRuntimeRegistry(batchId) {
  if (!batchId) return null;
  const registryPath = path.join(REPO_ROOT, ".pi", "runtime", batchId, "registry.json");
  try {
    if (!fs.existsSync(registryPath)) return null;
    return JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Load Runtime V2 lane snapshots for the current batch.
 * Returns a map of laneNumber → snapshot data.
 */
function loadRuntimeLaneSnapshots(batchId) {
  if (!batchId) return {};
  const lanesDir = path.join(REPO_ROOT, ".pi", "runtime", batchId, "lanes");
  const snapshots = {};
  try {
    if (!fs.existsSync(lanesDir)) return snapshots;
    const files = fs.readdirSync(lanesDir).filter(f => f.startsWith("lane-") && f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(lanesDir, file), "utf-8"));
        if (data.laneNumber != null) snapshots[data.laneNumber] = data;
      } catch { continue; }
    }
  } catch { /* dir missing */ }
  return snapshots;
}

/**
 * Load Runtime V2 agent events for a specific agent.
 * Returns the last N events from the agent's events.jsonl.
 */
function loadRuntimeAgentEvents(batchId, agentId, maxEvents) {
  if (!batchId || !agentId) return [];
  maxEvents = maxEvents || 200;
  const eventsPath = path.join(REPO_ROOT, ".pi", "runtime", batchId, "agents", agentId, "events.jsonl");
  try {
    if (!fs.existsSync(eventsPath)) return [];
    const raw = fs.readFileSync(eventsPath, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    const events = [];
    const start = Math.max(0, lines.length - maxEvents);
    for (let i = start; i < lines.length; i++) {
      try { events.push(JSON.parse(lines[i])); } catch { continue; }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Load mailbox message activity for the current batch.
 *
 * TP-093 hardening: event-authoritative model.
 * Primary source: .pi/mailbox/{batchId}/events.jsonl (audit event stream).
 * Fallback: directory scans (inbox/ack/outbox/outbox/processed) for
 * compatibility when events.jsonl is absent.
 *
 * Includes:
 * - Consumed replies (outbox/processed/) so they don't disappear after ack
 * - Per-recipient broadcast delivery state from ack markers
 * - Rate-limited events in the timeline
 */
function loadMailboxData(batchId) {
  if (!batchId) return { messages: [], agentIds: [], auditEvents: [] };
  const mbRoot = path.join(REPO_ROOT, ".pi", "mailbox", batchId);
  if (!fs.existsSync(mbRoot)) return { messages: [], agentIds: [], auditEvents: [] };

  // ── Primary: events.jsonl audit trail ──
  const auditEvents = loadMailboxAuditEvents(mbRoot);

  // ── Fallback: directory scan ──
  const messages = [];
  const agentIds = [];

  try {
    const dirs = fs.readdirSync(mbRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const agentDir of dirs) {
      if (agentDir === "_broadcast") continue;
      agentIds.push(agentDir);

      // Scan inbox (pending), ack (delivered), outbox (active replies), outbox/processed (consumed replies)
      for (const subdir of ["inbox", "ack", "outbox", "outbox/processed"]) {
        const dir = path.join(mbRoot, agentDir, subdir);
        if (!fs.existsSync(dir)) continue;
        try {
          const files = fs.readdirSync(dir).filter(f => f.endsWith(".msg.json"));
          for (const file of files) {
            try {
              const msg = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
              let status;
              if (subdir === "inbox") status = "pending";
              else if (subdir === "ack") status = "delivered";
              else if (subdir === "outbox") status = "reply";
              else status = "reply-acked"; // outbox/processed
              const isBroadcast = msg.to === "_broadcast";
              messages.push({ ...msg, _status: status, _agentDir: agentDir, _isBroadcast: isBroadcast });
            } catch { continue; }
          }
        } catch { continue; }
      }
    }

    // _broadcast: per-recipient delivery state
    const broadcastInbox = path.join(mbRoot, "_broadcast", "inbox");
    const broadcastAck = path.join(mbRoot, "_broadcast", "ack");
    for (const [dir, status] of [[broadcastInbox, "pending"], [broadcastAck, "delivered"]]) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith(".msg.json"));
        for (const file of files) {
          try {
            const msg = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
            messages.push({ ...msg, _status: status, _agentDir: "_broadcast", _isBroadcast: true });
          } catch { continue; }
        }
      } catch { continue; }
    }
  } catch { /* mailbox dir issues */ }

  messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return { messages, agentIds, auditEvents };
}

/**
 * Load mailbox audit events from events.jsonl.
 * Returns events sorted by timestamp. Includes: message_sent, message_delivered,
 * message_replied, message_escalated, message_rate_limited.
 */
function loadMailboxAuditEvents(mbRoot) {
  const eventsPath = path.join(mbRoot, "events.jsonl");
  if (!fs.existsSync(eventsPath)) return [];
  try {
    const raw = fs.readFileSync(eventsPath, "utf-8");
    const events = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { continue; }
    }
    return events;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
function loadTelemetryData(batchState) {
  const telemetryDir = path.join(REPO_ROOT, ".pi", "telemetry");
  const result = {};

  // Build lane number → tmux prefix mapping from batch state
  const laneToPrefix = {};
  if (batchState && batchState.lanes) {
    for (const lane of batchState.lanes) {
      const laneSessionId = lane.laneSessionId;
      if (lane.laneNumber != null && laneSessionId) {
        laneToPrefix[lane.laneNumber] = laneSessionId;
      }
    }
  }

  // Scan telemetry directory for JSONL files
  let files;
  try {
    files = fs.readdirSync(telemetryDir).filter(f => f.endsWith(".jsonl"));
  } catch {
    // .pi/telemetry/ may not exist (pre-RPC sessions) — degrade gracefully
    return result;
  }

  // Track which files still exist for tail-state cleanup
  const currentFiles = new Set();
  // Track current file→prefix mapping to detect file rotation
  const currentPrefixFiles = new Map(); // prefix → Set<filePath>

  for (const file of files) {
    const filePath = path.join(telemetryDir, file);
    currentFiles.add(filePath);

    // Parse filename to get lane number and role
    const parsed = parseTelemetryFilename(file);
    if (!parsed) continue;

    // Determine the key (tmux prefix)
    let prefix;
    if (parsed.role === "merger") {
      // Merge agent — derive prefix from lane naming so it matches the tmux
      // session name used by the client (e.g. "orch-henrylach-merge-1").
      // Lane sessions: "orch-{opId}-lane-{N}" → merge sessions: "orch-{opId}-merge-{N}".
      const firstLanePrefix = Object.values(laneToPrefix)[0]; // e.g. "orch-henrylach-lane-1"
      const opPrefix = firstLanePrefix?.replace(/-lane-\d+$/, ""); // "orch-henrylach"
      if (parsed.mergeNumber != null && opPrefix) {
        prefix = `${opPrefix}-merge-${parsed.mergeNumber}`;
      } else if (parsed.mergeNumber != null) {
        prefix = `orch-merge-${parsed.mergeNumber}`;
      } else {
        prefix = "orch-merge";
      }
    } else if (parsed.laneNumber != null && laneToPrefix[parsed.laneNumber]) {
      prefix = laneToPrefix[parsed.laneNumber];
    } else if (parsed.laneNumber != null) {
      // Lane number found but no batch-state mapping — use heuristic
      prefix = `orch-lane-${parsed.laneNumber}`;
    } else {
      // Standalone /task mode
      prefix = "standalone";
    }

    // Track file→prefix mapping
    if (!currentPrefixFiles.has(prefix)) currentPrefixFiles.set(prefix, new Set());
    currentPrefixFiles.get(prefix).add(filePath);

    // Check if file set for this prefix has changed (file rotation)
    const prevFiles = telemetryPrefixFiles.get(prefix);
    const isNewFile = !prevFiles || !prevFiles.has(filePath);

    // Initialize persistent accumulator for this prefix if needed,
    // or reset if files changed (new file appeared for same prefix)
    if (!telemetryAccumulators.has(prefix) || (isNewFile && !telemetryTailStates.has(filePath))) {
      const fresh = {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheWriteTokens: 0, cost: 0, toolCalls: 0,
        lastTool: "", currentTool: "", retries: 0, retryActive: false,
        lastRetryError: "", compactions: 0, latestTotalTokens: 0,
        contextPct: 0, startedAt: 0,
      };
      telemetryAccumulators.set(prefix, fresh);
      // Also reset tail states for ALL files of this prefix to re-read from beginning
      if (prevFiles) {
        for (const pf of prevFiles) {
          telemetryTailStates.delete(pf);
        }
      }
    }

    const acc = telemetryAccumulators.get(prefix);
    result[prefix] = acc; // expose the persistent accumulator in the result

    // Tail the file for new events
    const events = tailJsonlFile(filePath);

    // Check if file was truncated — reset accumulator
    const ts = telemetryTailStates.get(filePath);
    if (ts && ts.wasReset) {
      acc.inputTokens = 0; acc.outputTokens = 0; acc.cacheReadTokens = 0;
      acc.cacheWriteTokens = 0; acc.cost = 0; acc.toolCalls = 0;
      acc.lastTool = ""; acc.currentTool = ""; acc.retries = 0; acc.retryActive = false;
      acc.lastRetryError = ""; acc.compactions = 0; acc.latestTotalTokens = 0;
      acc.contextPct = 0; acc.startedAt = 0;
      ts.wasReset = false;
    }
    for (const event of events) {
      switch (event.type) {
        case "message_end": {
          // A successful message_end means any prior retry resolved.
          // Clear retryActive to prevent stale retry badges from persisting
          // across batches or after transient API errors recover.
          acc.retryActive = false;
          const usage = event.message?.usage;
          if (usage) {
            acc.inputTokens += usage.input || 0;
            acc.outputTokens += usage.output || 0;
            acc.cacheReadTokens += usage.cacheRead || 0;
            acc.cacheWriteTokens += usage.cacheWrite || 0;
            if (usage.cost) {
              acc.cost += typeof usage.cost === "object"
                ? (usage.cost.total || 0)
                : (typeof usage.cost === "number" ? usage.cost : 0);
            }
            // Include cacheRead: totalTokens from pi excludes cache reads,
            // but cached tokens still consume context window capacity.
            const rawTotal = usage.totalTokens
              || ((usage.input || 0) + (usage.output || 0));
            const totalTokens = rawTotal + (usage.cacheRead || 0);
            if (totalTokens > acc.latestTotalTokens) {
              acc.latestTotalTokens = totalTokens;
            }
          }
          break;
        }
        case "tool_execution_start": {
          acc.toolCalls++;
          const toolDesc = event.toolName || "unknown";
          let argPreview = "";
          if (event.args) {
            if (typeof event.args === "string") {
              argPreview = event.args.slice(0, 80);
            } else if (typeof event.args === "object") {
              const firstVal = Object.values(event.args)[0];
              if (typeof firstVal === "string") {
                argPreview = firstVal.slice(0, 80);
              }
            }
          }
          const toolLabel = argPreview ? `${toolDesc} ${argPreview}` : toolDesc;
          acc.lastTool = toolLabel;
          acc.currentTool = toolLabel;
          break;
        }
        case "tool_execution_end": {
          acc.currentTool = "";
          break;
        }
        case "agent_start": {
          if (event.ts && !acc.startedAt) {
            acc.startedAt = event.ts;
          }
          break;
        }
        case "response": {
          // Extract context usage from get_session_stats responses
          const ctxUsage = event.data?.contextUsage;
          if (ctxUsage) {
            // Support both percent (current) and percentUsed (legacy pi versions)
            const pct = typeof ctxUsage.percent === "number" ? ctxUsage.percent
              : typeof ctxUsage.percentUsed === "number" ? ctxUsage.percentUsed
              : null;
            if (pct !== null) acc.contextPct = pct;
          }
          break;
        }
        case "auto_retry_start": {
          acc.retries++;
          acc.retryActive = true;
          acc.lastRetryError = event.errorMessage || event.error || "unknown";
          break;
        }
        case "auto_retry_end": {
          acc.retryActive = false;
          break;
        }
        case "auto_compaction_start": {
          acc.compactions++;
          break;
        }
      }
    }
  }

  // Clean up tail states for files that no longer exist
  for (const [filePath] of telemetryTailStates) {
    if (filePath.startsWith(telemetryDir) && !currentFiles.has(filePath)) {
      telemetryTailStates.delete(filePath);
    }
  }

  // Update prefix→files tracking for next call
  // Clean up accumulators and tracking for prefixes that have no remaining files
  const activePrefixes = new Set(Object.keys(result));
  for (const [prefix] of telemetryAccumulators) {
    if (!activePrefixes.has(prefix)) {
      telemetryAccumulators.delete(prefix);
      telemetryPrefixFiles.delete(prefix);
    }
  }
  // Store current file mappings for next call's rotation detection
  for (const [prefix, fileSet] of currentPrefixFiles) {
    telemetryPrefixFiles.set(prefix, fileSet);
  }

  return result;
}

// ─── Supervisor Data Loading ────────────────────────────────────────────────

/**
 * Module-level tail state for supervisor JSONL files (actions.jsonl, events.jsonl).
 * Reuses the same incremental tailing pattern as telemetry.
 * Key: absolute file path → { offset, partial, entries }
 */
const supervisorTailStates = {
  actions: { offset: 0, partial: "", entries: [] },
  events: { offset: 0, partial: "", entries: [] },
  conversation: { offset: 0, partial: "", entries: [] },
};

/**
 * The last known batchId — used to detect batch changes and reset accumulators.
 */
let supervisorLastBatchId = "";

/**
 * Incrementally tail a JSONL file, accumulating parsed entries.
 * Filters entries by batchId when provided.
 *
 * @param {string} filePath - Absolute path to the JSONL file
 * @param {object} tailState - Mutable tail state { offset, partial, entries }
 * @param {string} batchId - Batch ID to filter by (empty = no filter)
 * @returns {object[]} The accumulated entries array (same reference as tailState.entries)
 */
function tailSupervisorJsonl(filePath, tailState, batchId) {
  // Check file size
  let fileSize;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch {
    return tailState.entries; // File doesn't exist yet — return accumulated
  }

  // Handle file truncation/recreation
  if (fileSize < tailState.offset) {
    tailState.offset = 0;
    tailState.partial = "";
    tailState.entries = [];
  }

  if (fileSize <= tailState.offset) {
    return tailState.entries; // No new data
  }

  // Read new bytes from offset
  const bytesToRead = fileSize - tailState.offset;
  const buf = Buffer.alloc(bytesToRead);
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return tailState.entries;
  }
  try {
    fs.readSync(fd, buf, 0, bytesToRead, tailState.offset);
  } catch {
    fs.closeSync(fd);
    return tailState.entries;
  }
  fs.closeSync(fd);
  tailState.offset = fileSize;

  // Split into lines, preserving partial trailing line
  const chunk = tailState.partial + buf.toString("utf-8");
  const lines = chunk.split("\n");
  tailState.partial = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      // Filter by batchId if provided
      if (batchId && entry.batchId && entry.batchId !== batchId) continue;
      tailState.entries.push(entry);
    } catch {
      // Malformed JSON — skip
    }
  }

  // Cap accumulated entries to prevent unbounded growth (keep last 500)
  if (tailState.entries.length > 500) {
    tailState.entries = tailState.entries.slice(-500);
  }

  return tailState.entries;
}

/**
 * Read supervisor autonomy level from project config.
 *
 * Checks `.pi/taskplane-config.json` for `orchestrator.supervisor.autonomy`.
 * Falls back to "supervised" (the default) if config is missing or malformed.
 * This is needed because the lockfile does not contain the autonomy level.
 *
 * @returns {string} Autonomy level: "interactive" | "supervised" | "autonomous"
 */
function loadSupervisorAutonomy() {
  try {
    const configPath = path.join(REPO_ROOT, ".pi", "taskplane-config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const autonomy = config?.orchestrator?.supervisor?.autonomy;
    if (autonomy === "interactive" || autonomy === "supervised" || autonomy === "autonomous") {
      return autonomy;
    }
  } catch {
    // Config missing or malformed — use default
  }
  return "supervised"; // Default per DEFAULT_SUPERVISOR_CONFIG
}

/**
 * Load supervisor data for the dashboard.
 *
 * Reads (all from .pi/supervisor/):
 * - lock.json: supervisor active/stale status, heartbeat, autonomy (from config)
 * - actions.jsonl: recovery action audit trail (batch-scoped, incremental)
 * - events.jsonl: engine + tier 0 events (batch-scoped, incremental)
 * - conversation.jsonl: operator ↔ supervisor interaction log (spec §9.1)
 * - summary.md: human-readable batch summary (generated on completion)
 *
 * Returns null when no supervisor files exist (pre-supervisor batches).
 *
 * @param {object|null} batchState - The batch state from batch-state.json
 * @returns {object|null} Supervisor data object or null
 */
function loadSupervisorData(batchState) {
  const supervisorDir = path.join(REPO_ROOT, ".pi", "supervisor");
  const batchId = batchState ? (batchState.batchId || "") : "";

  // Detect batch change — reset tail state accumulators
  if (batchId && batchId !== supervisorLastBatchId) {
    supervisorLastBatchId = batchId;
    supervisorTailStates.actions = { offset: 0, partial: "", entries: [] };
    supervisorTailStates.events = { offset: 0, partial: "", entries: [] };
    supervisorTailStates.conversation = { offset: 0, partial: "", entries: [] };
  }

  // ── Lockfile: supervisor status ──
  // The lockfile contains pid, sessionId, batchId, startedAt, heartbeat.
  // It does NOT contain autonomy — that comes from project config.
  let lock = null;
  try {
    const lockPath = path.join(supervisorDir, "lock.json");
    const raw = fs.readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.pid && parsed.sessionId) {
      // Determine if lock is stale (heartbeat older than 90s)
      const heartbeatAge = parsed.heartbeat
        ? Date.now() - new Date(parsed.heartbeat).getTime()
        : Infinity;
      const isStale = heartbeatAge > 90_000;

      lock = {
        active: !isStale,
        pid: parsed.pid,
        sessionId: parsed.sessionId,
        batchId: parsed.batchId || "",
        startedAt: parsed.startedAt || "",
        heartbeat: parsed.heartbeat || "",
        // Autonomy is NOT in the lockfile — derive from project config
        autonomy: loadSupervisorAutonomy(),
      };
    }
  } catch {
    // No lockfile or malformed — supervisor is inactive
  }

  // ── Actions JSONL: recovery audit trail (batch-scoped, incremental) ──
  const actionsPath = path.join(supervisorDir, "actions.jsonl");
  const actions = tailSupervisorJsonl(actionsPath, supervisorTailStates.actions, batchId);

  // ── Events JSONL: engine events (batch-scoped, incremental) ──
  const eventsPath = path.join(supervisorDir, "events.jsonl");
  const events = tailSupervisorJsonl(eventsPath, supervisorTailStates.events, batchId);

  // ── Conversation JSONL: operator interaction log (spec §9.1) ──
  // The supervisor writes operator↔supervisor messages to conversation.jsonl.
  // Not yet implemented in all supervisor versions — degrade gracefully.
  const conversationPath = path.join(supervisorDir, "conversation.jsonl");
  const conversation = tailSupervisorJsonl(conversationPath, supervisorTailStates.conversation, batchId);

  // ── Summary: human-readable batch summary (generated on completion) ──
  // Per spec §9.1, the supervisor writes .pi/supervisor/summary.md when the
  // batch completes or is abandoned. Read the file if it exists.
  let summary = null;
  try {
    const summaryPath = path.join(supervisorDir, "summary.md");
    summary = fs.readFileSync(summaryPath, "utf-8");
  } catch {
    // No summary yet — batch may still be running, or pre-supervisor batch
  }

  // If nothing exists at all, return null (pre-supervisor batch)
  if (!lock && actions.length === 0 && events.length === 0 && conversation.length === 0 && !summary) {
    // Check if the supervisor directory even exists
    try {
      fs.statSync(supervisorDir);
    } catch {
      return null; // No supervisor dir → pre-supervisor batch
    }
  }

  return {
    lock,
    actions,
    events,
    conversation,
    summary,
  };
}

/**
 * Compute batch total cost from lane states (primary) and telemetry (supplementary).
 * Lane states are authoritative — telemetry provides additional data only for lanes
 * that have no lane-state entry (e.g., very early in session startup).
 */
function computeBatchTotalCost(laneStates, telemetry) {
  let totalCost = 0;
  const coveredPrefixes = new Set();

  // Primary: sum cost from lane states (worker + reviewer)
  for (const [prefix, ls] of Object.entries(laneStates)) {
    if (ls.workerCostUsd) {
      totalCost += ls.workerCostUsd;
      coveredPrefixes.add(prefix);
    }
    if (ls.reviewerCostUsd) {
      totalCost += ls.reviewerCostUsd;
    }
  }

  // Supplementary: add cost from telemetry for uncovered lanes only
  for (const [prefix, tel] of Object.entries(telemetry)) {
    if (!coveredPrefixes.has(prefix) && tel.cost > 0) {
      totalCost += tel.cost;
    }
  }

  return totalCost;
}

function synthesizeLaneStateFromSnapshot(key, snap, fallbackBatchId) {
  const w = snap.worker || {};
  const r = snap.reviewer || null;
  const statusMap = { running: "running", spawning: "running", exited: "done", crashed: "error", killed: "error", timed_out: "error", wrapping_up: "running" };
  const reviewerStatusMap = { running: "running", spawning: "running", wrapping_up: "running", exited: "done", crashed: "done", killed: "done", timed_out: "done" };

  return {
    prefix: key,
    taskId: snap.taskId || null,
    phase: snap.status === "running" ? "worker-active" : snap.status === "complete" ? "complete" : "idle",
    workerStatus: statusMap[w.status] || w.status || "idle",
    workerElapsed: w.elapsedMs || 0,
    workerContextPct: w.contextPct || 0,
    workerLastTool: w.lastTool || "",
    workerToolCount: w.toolCalls || 0,
    workerInputTokens: w.inputTokens || 0,
    workerOutputTokens: w.outputTokens || 0,
    workerCacheReadTokens: w.cacheReadTokens || 0,
    workerCacheWriteTokens: w.cacheWriteTokens || 0,
    workerCostUsd: w.costUsd || 0,
    reviewerStatus: r ? (reviewerStatusMap[r.status] || r.status || "running") : "idle",
    reviewerElapsed: r?.elapsedMs || 0,
    reviewerContextPct: r?.contextPct || 0,
    reviewerLastTool: r?.lastTool || "",
    reviewerToolCount: r?.toolCalls || 0,
    reviewerCostUsd: r?.costUsd || 0,
    reviewerInputTokens: r?.inputTokens || 0,
    reviewerOutputTokens: r?.outputTokens || 0,
    reviewerCacheReadTokens: r?.cacheReadTokens || 0,
    reviewerCacheWriteTokens: r?.cacheWriteTokens || 0,
    reviewerType: r?.reviewType || "",
    reviewerStep: r?.reviewStep || 0,
    batchId: snap.batchId || fallbackBatchId,
    timestamp: snap.updatedAt || Date.now(),
  };
}

/** Build full dashboard state object for the frontend. */
function buildDashboardState() {
  const state = loadBatchState();
  const tmuxSessions = getTmuxSessions();
  const rawLaneStates = loadLaneStates();
  // Filter stale lane states from previous batches.
  // Lane state files persist across batches (same filename), so without
  // filtering the dashboard shows telemetry from old runs.
  const currentBatchId = state?.batchId || null;
  const laneStates = {};
  for (const [key, ls] of Object.entries(rawLaneStates)) {
    if (!currentBatchId || !ls.batchId || ls.batchId === currentBatchId) {
      laneStates[key] = ls;
    }
  }
  const telemetry = loadTelemetryData(state);
  const batchTotalCost = computeBatchTotalCost(laneStates, telemetry);
  const supervisor = loadSupervisorData(state);

  if (!state) {
    return { batch: null, tmuxSessions, laneStates: {}, telemetry: {}, batchTotalCost: 0, supervisor: null, timestamp: Date.now() };
  }

  const tasks = (state.tasks || []).map((task) => {
    const effectiveFolder = resolveTaskFolder(task, state);
    let statusData = null;
    if (effectiveFolder) {
      statusData = parseStatusMd(effectiveFolder);
    }
    if (!task.doneFileFound && effectiveFolder) {
      task.doneFileFound = checkDoneFile(effectiveFolder);
    }
    return { ...task, statusData };
  });

  // TP-107: Load Runtime V2 data when available
  const runtimeRegistry = loadRuntimeRegistry(state.batchId);
  const runtimeLaneSnapshots = loadRuntimeLaneSnapshots(state.batchId);
  const mailboxData = loadMailboxData(state.batchId);

  // TP-115: Synthesize laneStates from V2 snapshots so the dashboard
  // pipeline works without legacy lane-state-*.json sidecar files.
  // V2 snapshots are authoritative when present.
  if (Object.keys(runtimeLaneSnapshots).length > 0) {
    for (const [laneNum, snap] of Object.entries(runtimeLaneSnapshots)) {
      // Find the matching lane record to get the session name key
      const laneRec = (state.lanes || []).find(l => l.laneNumber === Number(laneNum));
      const key = laneRec ? (laneRec.laneSessionId) : `lane-${laneNum}`;
      if (!laneStates[key] || (snap.updatedAt && snap.updatedAt > (laneStates[key].timestamp || 0))) {
        laneStates[key] = synthesizeLaneStateFromSnapshot(key, snap, state.batchId);
      }
    }
  }

  return {
    laneStates,
    telemetry,
    batchTotalCost,
    supervisor,
    // Runtime V2 data (null/empty for legacy batches)
    runtimeRegistry,
    runtimeLaneSnapshots,
    mailbox: mailboxData,
    batch: {
      batchId: state.batchId,
      phase: state.phase,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      currentWaveIndex: state.currentWaveIndex || 0,
      totalWaves: state.totalWaves || (state.wavePlan ? state.wavePlan.length : 0),
      wavePlan: state.wavePlan || [],
      // Lanes already include repoId (string|undefined) from PersistedLaneRecord (v2).
      lanes: state.lanes || [],
      // Tasks already include repoId, resolvedRepoId (string|undefined) from PersistedTaskRecord (v2).
      tasks,
      mergeResults: state.mergeResults || [],
      errors: state.errors || [],
      lastError: state.lastError || null,
      // Workspace mode: "repo" (default/v1) or "workspace" (v2 multi-repo).
      // Additive field — absent in v1 state files, frontend must default to "repo".
      mode: state.mode || "repo",
    },
    tmuxSessions,
    timestamp: Date.now(),
  };
}

// ─── Static File Serving ────────────────────────────────────────────────────

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let filePath = new URL(req.url, "http://localhost").pathname;
  if (filePath === "/") filePath = "/index.html";

  const fullPath = path.join(PUBLIC_DIR, filePath);
  // Prevent directory traversal
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

// ─── SSE Stream ─────────────────────────────────────────────────────────────

const sseClients = new Set();

// ─── Pane Capture SSE ───────────────────────────────────────────────────

const paneClients = new Map(); // sessionName → Set<res>

function handlePaneSSE(req, res, sessionName) {
  // Validate session name (alphanumeric, dashes, underscores only)
  if (!/^[\w-]+$/.test(sessionName)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid session name");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  if (!paneClients.has(sessionName)) {
    paneClients.set(sessionName, new Set());
  }
  paneClients.get(sessionName).add(res);

  // Send initial capture immediately
  const initial = captureTmuxPane(sessionName);
  if (initial !== null) {
    res.write(`data: ${JSON.stringify({ output: initial, session: sessionName })}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ error: "Session not found or not accessible", session: sessionName })}\n\n`);
  }

  req.on("close", () => {
    const clients = paneClients.get(sessionName);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) paneClients.delete(sessionName);
    }
  });
}

function captureTmuxPane(_sessionName) {
  // Runtime V2 no longer captures TMUX panes.
  return null;
}

function broadcastPaneCaptures() {
  for (const [sessionName, clients] of paneClients) {
    if (clients.size === 0) continue;
    const output = captureTmuxPane(sessionName);
    if (output === null) continue;
    const payload = `data: ${JSON.stringify({ output, session: sessionName })}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  }
}

// ─── Conversation JSONL ─────────────────────────────────────────────────

function serveConversation(req, res, prefix) {
  if (!/^[\w-]+$/.test(prefix)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid prefix");
    return;
  }

  const filePath = path.join(REPO_ROOT, ".pi", `worker-conversation-${prefix}.jsonl`);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
  } catch {
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(""); // empty — no conversation yet
  }
}

// ─── Dashboard SSE ──────────────────────────────────────────────────────

function handleSSE(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial state immediately
  const state = buildDashboardState();
  res.write(`data: ${JSON.stringify(state)}\n\n`);

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

function broadcastState() {
  if (sseClients.size === 0) return;
  const state = buildDashboardState();
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ─── Batch History API ──────────────────────────────────────────────────────

// BATCH_HISTORY_PATH is initialized in main() alongside REPO_ROOT.

function loadHistory() {
  try {
    if (!fs.existsSync(BATCH_HISTORY_PATH)) return [];
    const raw = fs.readFileSync(BATCH_HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** GET /api/history — return list of batch summaries (compact: no per-task detail). */
function serveHistory(req, res) {
  const history = loadHistory();
  // Return compact list for the dropdown (no per-task details)
  const compact = history.map(h => ({
    batchId: h.batchId,
    status: h.status,
    startedAt: h.startedAt,
    endedAt: h.endedAt,
    durationMs: h.durationMs,
    totalWaves: h.totalWaves,
    totalTasks: h.totalTasks,
    succeededTasks: h.succeededTasks,
    failedTasks: h.failedTasks,
    tokens: h.tokens,
  }));
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(compact));
}

/** GET /api/history/:batchId — return full detail for one batch. */
function serveHistoryEntry(req, res, batchId) {
  const history = loadHistory();
  const entry = history.find(h => h.batchId === batchId);
  if (!entry) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Batch not found" }));
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(entry));
}

/** GET /api/status-md/:taskId — return raw STATUS.md content for a task. */
function serveStatusMd(req, res, taskId) {
  if (!/^[\w-]+$/.test(taskId)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid task ID");
    return;
  }

  const state = loadBatchState();
  if (!state) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No batch state" }));
    return;
  }

  const task = (state.tasks || []).find(t => t.taskId === taskId);
  if (!task) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Task not found" }));
    return;
  }

  const effectiveFolder = resolveTaskFolder(task, state);
  if (!effectiveFolder) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Cannot resolve task folder" }));
    return;
  }

  // Try effective folder, then archive
  const candidates = [effectiveFolder];
  const archiveBase = effectiveFolder.replace(/[/\\]tasks[/\\][^/\\]+$/, "/tasks/archive/" + taskId);
  if (archiveBase !== effectiveFolder) candidates.push(archiveBase);

  for (const folder of candidates) {
    const statusPath = path.join(folder, "STATUS.md");
    try {
      const content = fs.readFileSync(statusPath, "utf-8");
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(content);
      return;
    } catch { continue; }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "STATUS.md not found" }));
}

// ─── Dashboard Preferences ──────────────────────────────────────────────────

function getPreferencesPath() {
  return path.join(REPO_ROOT, ".pi", "dashboard-preferences.json");
}

function handleGetPreferences(req, res) {
  const prefsPath = getPreferencesPath();
  let prefs = { theme: "dark" };
  try {
    if (fs.existsSync(prefsPath)) {
      prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    }
  } catch { /* use defaults */ }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(prefs));
}

function handlePostPreferences(req, res) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try {
      const incoming = JSON.parse(body);
      const prefsPath = getPreferencesPath();
      let existing = {};
      try {
        if (fs.existsSync(prefsPath)) {
          existing = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
        }
      } catch { /* start fresh */ }
      const merged = { ...existing, ...incoming };
      const dir = path.dirname(prefsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(prefsPath, JSON.stringify(merged, null, 2) + "\n");
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(merged));
    } catch (err) {
      res.writeHead(400, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

// ─── HTTP Server ────────────────────────────────────────────────────────────

function createServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;

    if (pathname === "/api/stream" && req.method === "GET") {
      handleSSE(req, res);
    } else if (pathname.startsWith("/api/pane/") && req.method === "GET") {
      const sessionName = pathname.slice("/api/pane/".length);
      handlePaneSSE(req, res, sessionName);
    } else if (pathname.startsWith("/api/conversation/") && req.method === "GET") {
      const prefix = pathname.slice("/api/conversation/".length);
      serveConversation(req, res, prefix);
    } else if (pathname.startsWith("/api/agent-events/") && req.method === "GET") {
      // TP-107: Serve Runtime V2 agent events (hardened)
      const agentId = decodeURIComponent(pathname.slice("/api/agent-events/".length));
      // Strict validation: same pattern as /api/conversation/:prefix
      if (!/^[\w-]+$/.test(agentId)) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid agent ID");
        return;
      }
      const batchState = loadBatchState();
      // Path containment: verify resolved path stays inside runtime dir
      if (batchState?.batchId) {
        const runtimeBase = path.join(REPO_ROOT, ".pi", "runtime", batchState.batchId, "agents");
        const resolvedAgent = path.resolve(runtimeBase, agentId);
        if (!resolvedAgent.startsWith(path.resolve(runtimeBase))) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden");
          return;
        }
      }
      // Optional: ?sinceTs= to return only events after a timestamp
      const reqUrl = new URL(req.url, "http://localhost");
      const sinceTs = parseInt(reqUrl.searchParams.get("sinceTs") || "0", 10);
      let events = loadRuntimeAgentEvents(batchState?.batchId, agentId, 300);
      if (sinceTs > 0) {
        events = events.filter(e => (e.ts || 0) > sinceTs);
      }
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(events));
    } else if (pathname === "/api/state" && req.method === "GET") {
      const state = buildDashboardState();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(state));
    } else if (pathname === "/api/history" && req.method === "GET") {
      serveHistory(req, res);
    } else if (pathname.startsWith("/api/history/") && req.method === "GET") {
      const batchId = decodeURIComponent(pathname.slice("/api/history/".length));
      serveHistoryEntry(req, res, batchId);
    } else if (pathname.startsWith("/api/status-md/") && req.method === "GET") {
      const taskId = decodeURIComponent(pathname.slice("/api/status-md/".length));
      serveStatusMd(req, res, taskId);
    } else if (pathname === "/api/preferences" && req.method === "GET") {
      handleGetPreferences(req, res);
    } else if (pathname === "/api/preferences" && req.method === "POST") {
      handlePostPreferences(req, res);
    } else if (req.method === "OPTIONS") {
      // CORS preflight for POST
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
    } else {
      serveStatic(req, res);
    }
  });

  return server;
}

// ─── Browser Auto-Open ─────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "start"
    : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} ${url}`, () => {}); // fire-and-forget
}

// ─── Main ───────────────────────────────────────────────────────────────────

/** Try to listen on a port. Resolves with the port on success, rejects on EADDRINUSE. */
function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

/** Find an available port starting from `start`, trying up to MAX_PORT_ATTEMPTS. */
async function findPort(server, start, explicit) {
  // If the user explicitly passed --port, only try that one
  if (explicit) {
    try {
      return await tryListen(server, start);
    } catch (err) {
      if (err.code === "EADDRINUSE") {
        console.error(`\n  Port ${start} is already in use.`);
        console.error(`  Try: taskplane dashboard --port ${start + 1}\n`);
        process.exit(1);
      }
      throw err;
    }
  }
  // Auto-scan for an available port
  for (let port = start; port < start + MAX_PORT_ATTEMPTS; port++) {
    try {
      return await tryListen(server, port);
    } catch (err) {
      if (err.code === "EADDRINUSE") {
        // Close the server so we can retry on the next port
        server.close();
        server = createServer();
        continue;
      }
      throw err;
    }
  }
  console.error(`\n  No available port found in range ${start}-${start + MAX_PORT_ATTEMPTS - 1}.\n`);
  process.exit(1);
}

async function main() {
  const opts = parseArgs();

  // Resolve project root: --root flag > cwd.
  // In workspace mode this is the workspace root. All state/sidecar files
  // (batch-state, lane-state, conversation logs, batch-history) live at
  // <REPO_ROOT>/.pi/ and are NOT affected by taskplane-pointer.json.
  // The pointer only redirects config/agent resolution in task-runner and
  // orchestrator — the dashboard reads only runtime state, so no pointer
  // resolution is performed here.
  REPO_ROOT = path.resolve(opts.root || process.cwd());
  BATCH_STATE_PATH = path.join(REPO_ROOT, ".pi", "batch-state.json");
  BATCH_HISTORY_PATH = path.join(REPO_ROOT, ".pi", "batch-history.json");

  const server = createServer();
  const explicitPort = process.argv.slice(2).includes("--port");
  const port = await findPort(server, opts.port, explicitPort);

  console.log(`\n  Orchestrator Dashboard → http://localhost:${port}\n`);

  // Broadcast state to all SSE clients on interval
  const pollTimer = setInterval(broadcastState, POLL_INTERVAL);

  // Broadcast pane captures more frequently (1s) for smooth terminal viewing
  const paneTimer = setInterval(broadcastPaneCaptures, 1000);

  // Also watch batch-state.json for immediate push on change
  try {
    const batchDir = path.dirname(BATCH_STATE_PATH);
    if (fs.existsSync(batchDir)) {
      let debounce = null;
      fs.watch(batchDir, (eventType, filename) => {
        if (filename === "batch-state.json") {
          clearTimeout(debounce);
          debounce = setTimeout(broadcastState, 200);
        }
      });
    }
  } catch {
    // fs.watch not supported — polling is sufficient
  }

  // Auto-open browser
  if (opts.open) {
    setTimeout(() => openBrowser(`http://localhost:${port}`), 500);
  }

  // Graceful shutdown
  function cleanup() {
    clearInterval(pollTimer);
    clearInterval(paneTimer);
    for (const [, clients] of paneClients) {
      for (const client of clients) {
        try { client.end(); } catch {}
      }
    }
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    server.close();
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main();
