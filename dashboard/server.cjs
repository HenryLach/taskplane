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
const { execFileSync, exec } = require("child_process");
// url module not needed — we parse with new URL() below

// ─── Configuration ──────────────────────────────────────────────────────────

const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_PORT = 8100;
const MAX_PORT_ATTEMPTS = 20;
const POLL_INTERVAL = 2000; // ms between state checks

// REPO_ROOT is resolved after parseArgs() — see initialization below.
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

function loadBatchState() {
  try {
    const raw = fs.readFileSync(BATCH_STATE_PATH, "utf-8");
    return JSON.parse(raw);
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
  try {
    const output = execFileSync('tmux list-sessions -F "#{session_name}"', {
      encoding: "utf-8",
      timeout: 5000,
      shell: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output ? output.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
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

/** Build full dashboard state object for the frontend. */
function buildDashboardState() {
  const state = loadBatchState();
  const tmuxSessions = getTmuxSessions();
  const laneStates = loadLaneStates();

  if (!state) {
    return { batch: null, tmuxSessions, laneStates: {}, timestamp: Date.now() };
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

  return {
    laneStates,
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

function captureTmuxPane(sessionName) {
  try {
    // Capture with ANSI escape sequences (-e), full scrollback visible area (-p)
    const output = execFileSync(
      `tmux capture-pane -t "${sessionName}" -p -e`,
      { encoding: "utf-8", timeout: 3000, shell: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    return output;
  } catch {
    return null;
  }
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

  // Resolve project root: --root flag > cwd
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
