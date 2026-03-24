/**
 * Orchestrator Web Dashboard — Frontend
 *
 * Connects to SSE endpoint for live state updates.
 * Zero dependencies, vanilla JS.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (!ms || ms <= 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function relativeTime(epochOrIso) {
  if (!epochOrIso) return "";
  const ts = typeof epochOrIso === "string" ? new Date(epochOrIso).getTime() : epochOrIso;
  if (isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function pctClass(pct) {
  if (pct >= 100) return "pct-hi";
  if (pct >= 50) return "pct-mid";
  if (pct > 0) return "pct-low";
  return "pct-0";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Format token count as human-readable (e.g., 1.2k, 45k, 1.2M). */
function formatTokens(n) {
  if (!n || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function formatCost(usd) {
  if (!usd || usd === 0) return "";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Build a compact token summary string from lane state sidecar data.
 *  Display: ↑total_input ↓output (cost)
 *  Anthropic splits input into: uncached `input` + `cacheRead`.
 *  Both represent tokens the model processed as input.
 *  We show the combined figure as ↑ for clarity.
 */
function tokenSummaryFromLaneState(ls) {
  if (!ls) return "";
  const inp = ls.workerInputTokens || 0;
  const out = ls.workerOutputTokens || 0;
  const cr = ls.workerCacheReadTokens || 0;
  const cw = ls.workerCacheWriteTokens || 0;
  const cost = ls.workerCostUsd || 0;
  const totalIn = inp + cr; // uncached + cached = total input processed
  if (totalIn === 0 && out === 0) return "";
  let s = `↑${formatTokens(totalIn)} ↓${formatTokens(out)}`;
  if (cost > 0) s += ` ${formatCost(cost)}`;
  return s;
}

/** Build compact telemetry badge HTML for retry/compaction indicators.
 *  Only shows badges when telemetry data has meaningful values.
 *  @param {object|null} tel - Telemetry data for a lane (from currentData.telemetry[prefix])
 *  @returns {string} HTML string with badges, or "" if nothing to show
 */
function telemetryBadgesHtml(tel) {
  if (!tel) return "";
  let badges = "";
  if (tel.retryActive) {
    const err = tel.lastRetryError ? ` — ${tel.lastRetryError}` : "";
    badges += `<span class="telem-badge telem-retry-active" title="Retry in progress${escapeHtml(err)}">🔄 retrying</span>`;
  } else if (tel.retries > 0) {
    badges += `<span class="telem-badge telem-retry" title="${tel.retries} auto-retry event(s)">🔄 ${tel.retries}</span>`;
  }
  if (tel.compactions > 0) {
    badges += `<span class="telem-badge telem-compaction" title="${tel.compactions} context compaction(s)">🗜 ${tel.compactions}</span>`;
  }
  return badges;
}

// ─── Copy to Clipboard ──────────────────────────────────────────────────────

let toastEl = null;
let toastTimer = null;

function showCopyToast(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "copy-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = `Copied: ${text}`;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2000);
}

function copyTmuxCmd(sessionName) {
  const cmd = `tmux attach -t ${sessionName}`;
  navigator.clipboard.writeText(cmd).then(() => {
    showCopyToast(cmd);
    // Flash the button
    const btn = document.querySelector(`[data-tmux="${sessionName}"]`);
    if (btn) {
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1500);
    }
  }).catch(() => {
    // Fallback: select the text
    const btn = document.querySelector(`[data-tmux="${sessionName}"]`);
    if (btn) {
      const range = document.createRange();
      range.selectNodeContents(btn);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
}



// ─── DOM References ─────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const $batchId        = $("batch-id");
const $batchPhase     = $("batch-phase");
const $connDot        = $("conn-dot");
const $lastUpdate     = $("last-update");
const $progressBarBg  = $("progress-bar-bg");
const $overallPct     = $("overall-pct");
const $summaryCounts  = $("summary-counts");
const $summaryElapsed = $("summary-elapsed");
const $summaryWaves   = $("summary-waves");
const $lanesTasksBody = $("lanes-tasks-body");
const $mergeBody      = $("merge-body");
const $errorsPanel    = $("errors-panel");
const $errorsBody     = $("errors-body");
const $footerInfo     = $("footer-info");
const $content        = $("content");
const $historySelect  = $("history-select");
const $historyPanel   = $("history-panel");
const $historyBody    = $("history-body");

// ─── Repo Filter State ──────────────────────────────────────────────────────

const $repoFilter = $("repo-filter");
let selectedRepo = "";       // "" means "All repos"
let knownRepos = [];         // sorted list of known repo IDs
let repoFilterVisible = false;

// ─── History State ──────────────────────────────────────────────────────────

let historyList = [];  // compact batch summaries
let viewingHistoryId = null; // batchId if viewing history, null if live

// ─── Viewer State ───────────────────────────────────────────────────────────

let viewerMode = null;   // "conversation" | "status-md" | null
let viewerTarget = null; // session name (conversation) or taskId (status-md)

// ─── Repo Helpers ───────────────────────────────────────────────────────────

/**
 * Build a sorted, deduplicated list of repo IDs from the batch payload.
 * Returns empty array when mode !== "workspace" or when fewer than 2 repos.
 */
function buildRepoSet(batch) {
  if (!batch || batch.mode !== "workspace") return [];

  const repos = new Set();
  for (const lane of (batch.lanes || [])) {
    if (lane.repoId) repos.add(lane.repoId);
  }
  for (const task of (batch.tasks || [])) {
    const rid = task.resolvedRepoId || task.repoId;
    if (rid) repos.add(rid);
  }
  for (const mr of (batch.mergeResults || [])) {
    for (const rr of (mr.repoResults || [])) {
      if (rr.repoId) repos.add(rr.repoId);
    }
  }
  const sorted = Array.from(repos).sort();
  return sorted.length >= 2 ? sorted : [];
}

/**
 * Update the repo filter dropdown options and visibility.
 * Resets selection to "All repos" if the previously selected repo disappeared.
 */
function updateRepoFilter(repos) {
  knownRepos = repos;
  const shouldShow = repos.length >= 2;

  if (shouldShow !== repoFilterVisible) {
    $repoFilter.style.display = shouldShow ? "" : "none";
    repoFilterVisible = shouldShow;
  }

  if (!shouldShow) {
    selectedRepo = "";
    return;
  }

  // If selected repo disappeared, reset to "All"
  if (selectedRepo && !repos.includes(selectedRepo)) {
    selectedRepo = "";
  }

  // Rebuild options only if repo set changed
  const currentOpts = Array.from($repoFilter.options).slice(1).map(o => o.value);
  const changed = currentOpts.length !== repos.length || currentOpts.some((v, i) => v !== repos[i]);
  if (changed) {
    // Preserve selection
    const prev = selectedRepo;
    $repoFilter.innerHTML = '<option value="">All repos</option>';
    for (const r of repos) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      $repoFilter.appendChild(opt);
    }
    $repoFilter.value = prev;
  }
}

/** Get the effective repo ID for a task (prefer resolvedRepoId, fallback repoId). */
function taskRepoId(task) {
  return task.resolvedRepoId || task.repoId || undefined;
}

/** Render a repo badge span. Returns "" if repoId is falsy or repos not active. */
function repoBadgeHtml(repoId, extraClass) {
  if (!repoId || knownRepos.length < 2) return "";
  return `<span class="repo-badge ${extraClass || ""}" title="Repo: ${escapeHtml(repoId)}">${escapeHtml(repoId)}</span>`;
}

// Repo filter change handler
$repoFilter.addEventListener("change", (e) => {
  selectedRepo = e.target.value;
  // Re-render with current data
  if (currentData) {
    const batch = currentData.batch;
    const tmux = currentData.tmuxSessions || [];
    if (batch) {
      renderLanesTasks(batch, tmux);
      renderMergeAgents(batch, tmux);
    }
  }
});

// ─── Render: Header ─────────────────────────────────────────────────────────

function renderHeader(batch) {
  if (!batch) {
    $batchId.textContent = "—";
    $batchPhase.textContent = "No batch";
    $batchPhase.className = "header-badge badge-phase";
    return;
  }
  $batchId.textContent = batch.batchId;
  $batchPhase.textContent = batch.phase;
  $batchPhase.className = `header-badge badge-phase phase-${batch.phase}`;
}

// ─── Render: Summary ────────────────────────────────────────────────────────

function renderSummary(batch) {
  if (!batch) {
    $progressBarBg.innerHTML = "";
    $overallPct.textContent = "0%";
    $summaryCounts.innerHTML = "";
    $summaryElapsed.textContent = "—";
    $summaryWaves.innerHTML = "";
    return;
  }

  const tasks = batch.tasks || [];
  const total = tasks.length;
  const succeeded = tasks.filter(t => t.status === "succeeded").length;
  const running   = tasks.filter(t => t.status === "running").length;
  const failed    = tasks.filter(t => t.status === "failed").length;
  const stalled   = tasks.filter(t => t.status === "stalled").length;
  const pending   = tasks.filter(t => t.status === "pending").length;

  // ── Checkbox-based progress by wave ──────────────────────────
  const taskMap = new Map(tasks.map(t => [t.taskId, t]));
  const wavePlan = batch.wavePlan || [tasks.map(t => t.taskId)]; // fallback: single wave
  const currentWaveIdx = batch.currentWaveIndex || 0;

  // Compute per-wave and overall checkbox totals
  let batchChecked = 0, batchTotal = 0;
  const waveStats = wavePlan.map((taskIds, waveIdx) => {
    let wChecked = 0, wTotal = 0;
    let allSucceeded = taskIds.length > 0;
    for (const tid of taskIds) {
      const t = taskMap.get(tid);
      if (!t || t.status !== "succeeded") allSucceeded = false;
      if (t && t.status === "succeeded" && t.statusData) {
        // Succeeded task with statusData: count as fully done even if
        // STATUS.md checkboxes weren't all ticked before .DONE was created
        const total = t.statusData.total || 1;
        wChecked += total;
        wTotal += total;
      } else if (t && t.statusData) {
        wChecked += t.statusData.checked || 0;
        wTotal += t.statusData.total || 0;
      } else if (t && t.status === "succeeded") {
        // Succeeded tasks may not have statusData if STATUS.md was cleaned up
        // Count as fully done — use a small placeholder if no data
        wChecked += 1;
        wTotal += 1;
      }
    }
    batchChecked += wChecked;
    batchTotal += wTotal;
    return { waveIdx, taskIds, checked: wChecked, total: wTotal, allSucceeded };
  });

  const overallPct = batchTotal > 0 ? Math.round((batchChecked / batchTotal) * 100) : 0;
  $overallPct.textContent = `${overallPct}%`;

  // Build segmented progress bar — each wave gets a proportional segment
  let barHtml = "";
  for (const ws of waveStats) {
    const segWidthPct = batchTotal > 0 ? (ws.total / batchTotal) * 100 : (100 / waveStats.length);
    const fillPct = ws.total > 0 ? (ws.checked / ws.total) * 100 : 0;
    const checkboxDone = ws.checked === ws.total && ws.total > 0;
    const pastWave = ws.waveIdx < currentWaveIdx;
    const batchDone = batch.phase === "completed" || batch.phase === "merging";
    const isDone = checkboxDone || pastWave || batchDone || ws.allSucceeded;
    const isCurrent = ws.waveIdx === currentWaveIdx && (batch.phase === "executing" || batch.phase === "merging");
    const isFuture = ws.waveIdx > currentWaveIdx && batch.phase === "executing";

    const fillClass = isDone ? "pct-hi" : fillPct > 50 ? "pct-mid" : fillPct > 0 ? "pct-low" : "pct-0";
    const fillWidth = isDone ? 100 : fillPct;
    const segClass = isCurrent ? "wave-seg-current" : isFuture ? "wave-seg-future" : "";

    barHtml += `<div class="wave-seg ${segClass}" style="width:${segWidthPct.toFixed(1)}%" title="W${ws.waveIdx + 1}: ${ws.checked}/${ws.total} checkboxes (${ws.taskIds.join(', ')})">`;
    barHtml += `  <div class="wave-seg-fill ${fillClass}" style="width:${fillWidth.toFixed(1)}%"></div>`;
    barHtml += `  <span class="wave-seg-label">W${ws.waveIdx + 1}</span>`;
    barHtml += `</div>`;
  }
  $progressBarBg.innerHTML = barHtml;

  let countsHtml = "";
  if (succeeded > 0) countsHtml += `<span class="count-chip count-succeeded"><span class="count-num">${succeeded}</span><span class="count-icon">✓</span></span>`;
  if (running > 0)   countsHtml += `<span class="count-chip count-running"><span class="count-num">${running}</span><span class="count-icon">▶</span></span>`;
  if (failed > 0)    countsHtml += `<span class="count-chip count-failed"><span class="count-num">${failed}</span><span class="count-icon">✗</span></span>`;
  if (stalled > 0)   countsHtml += `<span class="count-chip count-stalled"><span class="count-num">${stalled}</span><span class="count-icon">⏸</span></span>`;
  if (pending > 0)   countsHtml += `<span class="count-chip count-pending"><span class="count-num">${pending}</span><span class="count-icon">◌</span></span>`;
  countsHtml += `<span class="count-total">/ ${total}</span>`;
  $summaryCounts.innerHTML = countsHtml;

  const elapsed = batch.startedAt ? Date.now() - batch.startedAt : 0;
  let elapsedStr = `elapsed: ${formatDuration(elapsed)}`;
  if (batch.updatedAt) elapsedStr += `  ·  updated: ${relativeTime(batch.updatedAt)}`;

  // Aggregate tokens across all active lane states
  const laneStates = currentData?.laneStates || {};
  let batchInput = 0, batchOutput = 0, batchCacheRead = 0, batchCacheWrite = 0, batchCostFromLanes = 0;
  for (const ls of Object.values(laneStates)) {
    batchInput += ls.workerInputTokens || 0;
    batchOutput += ls.workerOutputTokens || 0;
    batchCacheRead += ls.workerCacheReadTokens || 0;
    batchCacheWrite += ls.workerCacheWriteTokens || 0;
    batchCostFromLanes += ls.workerCostUsd || 0;
  }
  // Use server-computed batchTotalCost (includes telemetry for uncovered lanes);
  // fallback to lane-state-only sum for backward compatibility (pre-telemetry server)
  const batchCost = (currentData?.batchTotalCost != null && currentData.batchTotalCost > 0)
    ? currentData.batchTotalCost
    : batchCostFromLanes;
  const batchTotalIn = batchInput + batchCacheRead;
  if (batchTotalIn > 0 || batchOutput > 0) {
    let tokenStr = `  ·  tokens: ↑${formatTokens(batchTotalIn)} ↓${formatTokens(batchOutput)}`;
    if (batchCost > 0) tokenStr += `  ·  cost: ${formatCost(batchCost)}`;
    elapsedStr += tokenStr;
  }

  $summaryElapsed.textContent = elapsedStr;

  // Waves
  if (batch.wavePlan && batch.wavePlan.length > 0) {
    const waveIdx = batch.currentWaveIndex || 0;
    let wavesHtml = '<span style="color:var(--text-muted); font-weight:600; margin-right:4px;">Waves</span>';
    batch.wavePlan.forEach((taskIds, i) => {
      const isDone = i < waveIdx || batch.phase === "completed" || batch.phase === "merging";
      const isCurrent = i === waveIdx && batch.phase === "executing";
      const cls = isDone ? "done" : isCurrent ? "current" : "";
      wavesHtml += `<span class="wave-chip ${cls}">W${i + 1} [${taskIds.join(", ")}]</span>`;
    });
    $summaryWaves.innerHTML = wavesHtml;
  } else {
    $summaryWaves.innerHTML = "";
  }
}

// ─── Render: Lanes + Tasks (integrated) ─────────────────────────────────────

function renderLanesTasks(batch, tmuxSessions) {
  if (!batch || !batch.lanes || batch.lanes.length === 0) {
    $lanesTasksBody.innerHTML = '<div class="empty-state">No lanes</div>';
    return;
  }

  const tasks = batch.tasks || [];
  const tmuxSet = new Set(tmuxSessions || []);
  const laneStates = currentData?.laneStates || {};
  const telemetry = currentData?.telemetry || {};
  const showRepos = knownRepos.length >= 2;
  let html = "";

  for (const lane of batch.lanes) {
    // Repo filtering: if a repo is selected, skip lanes that don't match
    if (selectedRepo && showRepos) {
      const laneTasks = (lane.taskIds || []).map(tid => tasks.find(t => t.taskId === tid)).filter(Boolean);
      const laneMatchesRepo = (lane.repoId === selectedRepo) ||
        laneTasks.some(t => (taskRepoId(t) || lane.repoId) === selectedRepo);
      if (!laneMatchesRepo) continue;
    }

    const alive = tmuxSet.has(lane.tmuxSessionName);
    const tmuxCmd = `tmux attach -t ${lane.tmuxSessionName}`;

    // Lane header
    html += `<div class="lane-group">`;
    html += `<div class="lane-header">`;
    html += `  <span class="lane-num">${lane.laneNumber}</span>`;
    html += `  <div class="lane-meta">`;
    html += `    <span class="lane-session">${escapeHtml(lane.tmuxSessionName || "—")}</span>`;
    html += `    <span class="lane-branch">${escapeHtml(lane.branch || "—")}</span>`;
    if (showRepos && lane.repoId) {
      html += `    ${repoBadgeHtml(lane.repoId, "repo-badge-lane")}`;
    }
    html += `  </div>`;
    html += `  <div class="lane-right">`;
    html += `    <span class="tmux-dot ${alive ? "alive" : "dead"}" title="${alive ? "tmux alive" : "tmux dead"}"></span>`;
    // View button: shows conversation stream if available, else tmux pane
    const isViewingConv = viewerMode === 'conversation' && viewerTarget === lane.tmuxSessionName;
    html += `    <button class="tmux-view-btn${isViewingConv ? ' active' : ''}" onclick="viewConversation('${escapeHtml(lane.tmuxSessionName)}')" title="View worker conversation">👁 View</button>`;
    if (alive) {
      html += `    <span class="tmux-cmd" data-tmux="${escapeHtml(lane.tmuxSessionName)}" onclick="copyTmuxCmd('${escapeHtml(lane.tmuxSessionName)}')" title="Click to copy">${escapeHtml(tmuxCmd)}</span>`;
    } else {
      html += `    <span class="tmux-cmd dead-session">${escapeHtml(tmuxCmd)}</span>`;
    }
    html += `  </div>`;
    html += `</div>`;

    // Task rows for this lane
    const laneTasks = (lane.taskIds || []).map(tid => tasks.find(t => t.taskId === tid)).filter(Boolean);

    if (laneTasks.length === 0) {
      html += `<div class="task-row"><span class="task-icon"></span><span style="color:var(--text-faint);grid-column:2/-1;">No tasks assigned</span></div>`;
    }

    // Get lane state and telemetry for worker stats
    const ls = laneStates[lane.tmuxSessionName] || null;
    const tel = telemetry[lane.tmuxSessionName] || null;

    for (const task of laneTasks) {
      // Repo filtering at task level
      const tRepo = taskRepoId(task) || lane.repoId;
      if (selectedRepo && showRepos && tRepo !== selectedRepo) continue;

      const sd = task.statusData;
      const dur = task.startedAt
        ? formatDuration((task.endedAt || Date.now()) - task.startedAt)
        : "—";

      // Progress cell
      let progressHtml = "";
      if (sd) {
        const fillClass = pctClass(sd.progress);
        progressHtml = `
          <div class="task-progress">
            <div class="task-progress-bar">
              <div class="task-progress-fill ${fillClass}" style="width:${sd.progress}%"></div>
            </div>
            <span class="task-progress-text">${sd.progress}% ${sd.checked}/${sd.total}</span>
          </div>`;
      } else if (task.status === "succeeded") {
        progressHtml = `
          <div class="task-progress">
            <div class="task-progress-bar"><div class="task-progress-fill pct-hi" style="width:100%"></div></div>
            <span class="task-progress-text">100%</span>
          </div>`;
      } else if (task.status === "pending") {
        progressHtml = `
          <div class="task-progress">
            <div class="task-progress-bar"><div class="task-progress-fill pct-0" style="width:0%"></div></div>
            <span class="task-progress-text">0%</span>
          </div>`;
      } else {
        progressHtml = '<span style="color:var(--text-faint)">—</span>';
      }

      // Step cell
      let stepHtml = "";
      if (sd) {
        stepHtml = escapeHtml(sd.currentStep);
        if (sd.iteration > 0) stepHtml += `<span class="task-iter">i${sd.iteration}</span>`;
        if (sd.reviews > 0) stepHtml += `<span class="task-iter">r${sd.reviews}</span>`;
      } else if (task.status === "succeeded") {
        stepHtml = '<span style="color:var(--green)">Complete</span>';
      } else if (task.status === "pending") {
        stepHtml = '<span style="color:var(--text-faint)">Waiting</span>';
      } else {
        stepHtml = `<span style="color:var(--text-faint)">${escapeHtml(task.exitReason || "—")}</span>`;
      }

      // Worker stats from lane state sidecar + telemetry badges
      let workerHtml = "";
      const telemBadges = task.status !== "pending" ? telemetryBadgesHtml(tel) : "";
      // Reviewer sub-row should only appear under the task currently being reviewed,
      // not all tasks in the lane. The lane-state sidecar is per-lane (shared by all
      // tasks in the lane), so check that the sidecar's current taskId matches this task.
      const reviewerActive = ls && ls.reviewerStatus === "running" && ls.taskId === task.taskId;
      if (ls && ls.workerStatus === "running" && task.status === "running") {
        const elapsed = ls.workerElapsed ? `${Math.round(ls.workerElapsed / 1000)}s` : "";
        const tools = ls.workerToolCount || 0;
        const ctx = ls.workerContextPct ? `${Math.round(ls.workerContextPct)}%` : "";
        const lastTool = reviewerActive ? "[awaiting review]" : (ls.workerLastTool || "");
        const tokenStr = tokenSummaryFromLaneState(ls);
        workerHtml = `<div class="worker-stats">`;
        workerHtml += `<span class="worker-stat" title="Worker elapsed">⏱ ${elapsed}</span>`;
        workerHtml += `<span class="worker-stat" title="Tool calls">🔧 ${tools}</span>`;
        if (ctx) workerHtml += `<span class="worker-stat" title="Context window used">📊 ${ctx}</span>`;
        if (tokenStr) workerHtml += `<span class="worker-stat" title="Tokens: input↑ output↓ cacheRead(R) cacheWrite(W)">🪙 ${tokenStr}</span>`;
        if (lastTool) workerHtml += `<span class="worker-stat worker-last-tool" title="${reviewerActive ? 'Waiting for reviewer' : 'Last tool call'}">${reviewerActive ? '<span style="color:var(--yellow)">' + escapeHtml(lastTool) + '</span>' : escapeHtml(lastTool)}</span>`;
        workerHtml += telemBadges;
        workerHtml += `</div>`;
      } else if (!ls && tel && task.status === "running") {
        // Running task with telemetry but no lane-state yet (early startup)
        const lastTool = tel.lastTool || "";
        workerHtml = `<div class="worker-stats">`;
        if (lastTool) workerHtml += `<span class="worker-stat worker-last-tool" title="Last tool call">${escapeHtml(lastTool)}</span>`;
        workerHtml += telemBadges;
        workerHtml += `</div>`;
      } else if (ls && ls.workerStatus === "done" && task.status !== "pending") {
        workerHtml = `<div class="worker-stats"><span class="worker-stat" style="color:var(--green)">✓ Worker done</span>${telemBadges}</div>`;
      } else if (ls && ls.workerStatus === "error" && task.status !== "pending") {
        workerHtml = `<div class="worker-stats"><span class="worker-stat" style="color:var(--red)">✗ Worker error</span>${telemBadges}</div>`;
      } else if (telemBadges && task.status !== "pending") {
        // No lane-state but telemetry exists (done/error lane without sidecar)
        workerHtml = `<div class="worker-stats">${telemBadges}</div>`;
      }

      // Reviewer sub-row: shown when reviewer is actively running
      let reviewerRowHtml = "";
      if (reviewerActive) {
        const rElapsed = ls.reviewerElapsed ? `${Math.round(ls.reviewerElapsed / 1000)}s` : "";
        const rTools = ls.reviewerToolCount || 0;
        const rCtx = ls.reviewerContextPct ? `${Math.round(ls.reviewerContextPct)}%` : "";
        const rLastTool = ls.reviewerLastTool || "";
        const rCost = ls.reviewerCostUsd ? `$${ls.reviewerCostUsd.toFixed(2)}` : "";
        const rType = ls.reviewerType || "review";
        const rStep = ls.reviewerStep || "?";
        reviewerRowHtml = `
          <div class="task-row reviewer-sub-row">
            <span class="task-icon"></span>
            <span class="task-actions"></span>
            <span class="reviewer-label">📋 Reviewer</span>
            <span class="reviewer-type">${escapeHtml(rType)} · Step ${rStep}</span>
            <span class="task-duration">${rElapsed}</span>
            <span></span>
            <span class="task-step">
              <div class="worker-stats reviewer-stats">
                <span class="worker-stat" title="Reviewer tool calls">🔧 ${rTools}</span>
                ${rCtx ? `<span class="worker-stat" title="Reviewer context used">📊 ${rCtx}</span>` : ""}
                ${rCost ? `<span class="worker-stat" title="Reviewer cost">${rCost}</span>` : ""}
                ${rLastTool ? `<span class="worker-stat worker-last-tool" title="Reviewer last tool">${escapeHtml(rLastTool)}</span>` : ""}
              </div>
            </span>
          </div>`;
      }

      const isViewingStatus = viewerMode === 'status-md' && viewerTarget === task.taskId;
      const eyeHtml = task.status !== 'pending'
        ? `<button class="viewer-eye-btn${isViewingStatus ? ' active' : ''}" onclick="viewStatusMd('${escapeHtml(task.taskId)}')" title="View STATUS.md">👁</button>`
        : '';

      html += `
        <div class="task-row">
          <span class="task-icon"><span class="status-dot ${task.status}"></span></span>
          <span class="task-actions">${eyeHtml}</span>
          <span class="task-id status-${task.status}">${escapeHtml(task.taskId)}${showRepos ? repoBadgeHtml(tRepo, "repo-badge-task") : ""}</span>
          <span><span class="status-badge status-${task.status}"><span class="status-dot ${task.status}"></span> ${task.status}</span></span>
          <span class="task-duration">${dur}</span>
          <span>${progressHtml}</span>
          <span class="task-step">${stepHtml}${workerHtml}</span>
        </div>`;
      html += reviewerRowHtml;
    }

    html += `</div>`; // close lane-group
  }

  $lanesTasksBody.innerHTML = html;
}

// ─── Render: Merge Agents ───────────────────────────────────────────────────

function renderMergeAgents(batch, tmuxSessions) {
  const mergeResults = batch?.mergeResults || [];
  const tmuxSet = new Set(tmuxSessions || []);
  const showRepos = knownRepos.length >= 2;
  const telemetry = currentData?.telemetry || {};

  // Check for active merge sessions (convention: orch-merge-*)
  const mergeSessions = (tmuxSessions || []).filter(s => s.startsWith("orch-merge"));

  if (mergeResults.length === 0 && mergeSessions.length === 0) {
    $mergeBody.innerHTML = '<div class="empty-state">No merge agents active</div>';
    return;
  }

  let html = '<table class="merge-table"><thead><tr>';
  html += '<th>Wave</th><th>Status</th><th>Session</th><th>Telemetry</th><th>Attach</th><th>Details</th>';
  html += '</tr></thead><tbody>';

  // Show merge results
  for (const mr of mergeResults) {
    // Repo filtering: if a repo is selected and this merge has repoResults,
    // check if the selected repo is among them
    const repoResults = mr.repoResults || [];
    if (selectedRepo && showRepos && repoResults.length >= 1) {
      const hasSelectedRepo = repoResults.some(rr => rr.repoId === selectedRepo);
      if (!hasSelectedRepo) continue;
    }

    const statusCls = mr.status === "succeeded" ? "status-succeeded"
      : mr.status === "partial" ? "status-stalled"
      : "status-failed";

    // Look for matching tmux session
    const sessionName = `orch-merge-w${mr.waveIndex + 1}`;
    const alive = tmuxSet.has(sessionName);

    // Look for merge telemetry data
    const mergeTel = telemetry[sessionName] || telemetry[`orch-merge-${mr.waveIndex + 1}`] || null;

    html += `<tr>`;
    html += `<td style="font-family:var(--font-mono);">Wave ${mr.waveIndex + 1}</td>`;
    html += `<td><span class="status-badge ${statusCls}">${mr.status}</span></td>`;
    html += `<td style="font-family:var(--font-mono);font-size:0.8rem;">${alive ? escapeHtml(sessionName) : "—"}</td>`;
    // Telemetry cell
    html += `<td style="font-size:0.75rem;">`;
    if (mergeTel) {
      const totalTok = (mergeTel.inputTokens || 0) + (mergeTel.outputTokens || 0);
      const cost = mergeTel.cost || 0;
      if (totalTok > 0 || cost > 0) {
        html += `<span style="color:var(--text-muted);">${totalTok > 0 ? totalTok.toLocaleString() + " tok" : ""}`;
        if (cost > 0) html += ` · $${cost.toFixed(4)}`;
        html += `</span>`;
      } else {
        html += '<span style="color:var(--text-faint);">—</span>';
      }
    } else {
      html += '<span style="color:var(--text-faint);">—</span>';
    }
    html += `</td>`;
    html += `<td>`;
    if (alive) {
      const cmd = `tmux attach -t ${sessionName}`;
      html += `<span class="tmux-cmd" data-tmux="${escapeHtml(sessionName)}" onclick="copyTmuxCmd('${escapeHtml(sessionName)}')" title="Click to copy">${escapeHtml(cmd)}</span>`;
    } else {
      html += '<span style="color:var(--text-faint);">—</span>';
    }
    html += `</td>`;
    html += `<td style="font-size:0.8rem;color:var(--text-muted);">${mr.failureReason ? escapeHtml(mr.failureReason) : "—"}</td>`;
    html += `</tr>`;

    // Per-repo sub-rows: show when workspace mode has repo results
    if (showRepos && repoResults.length >= 1) {
      const displayRepos = selectedRepo
        ? repoResults.filter(rr => rr.repoId === selectedRepo)
        : repoResults;

      for (const rr of displayRepos) {
        const rrStatusCls = rr.status === "succeeded" ? "status-succeeded"
          : rr.status === "partial" ? "status-stalled"
          : "status-failed";
        const rrLanes = (rr.laneNumbers || []).map(n => `L${n}`).join(", ") || "—";
        const rrDetail = rr.failureReason ? escapeHtml(rr.failureReason) : "—";

        html += `<tr class="merge-repo-row">`;
        html += `<td>${repoBadgeHtml(rr.repoId)}</td>`;
        html += `<td><span class="status-badge ${rrStatusCls}">${rr.status}</span></td>`;
        html += `<td style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-faint);">${rrLanes}</td>`;
        html += `<td></td>`; /* telemetry placeholder */
        html += `<td></td>`; /* attach placeholder */
        html += `<td style="font-size:0.75rem;color:var(--text-faint);">${rrDetail}</td>`;
        html += `</tr>`;
      }
    }
  }

  // Show active merge sessions not yet in results
  for (const sess of mergeSessions) {
    const alreadyShown = mergeResults.some((mr) => `orch-merge-w${mr.waveIndex + 1}` === sess);
    if (alreadyShown) continue;

    const sessTel = telemetry[sess] || null;
    const cmd = `tmux attach -t ${sess}`;
    html += `<tr>`;
    html += `<td style="font-family:var(--font-mono);">—</td>`;
    html += `<td><span class="status-badge status-running"><span class="status-dot running"></span> merging</span></td>`;
    html += `<td style="font-family:var(--font-mono);font-size:0.8rem;">${escapeHtml(sess)}</td>`;
    // Telemetry cell for active merge session
    html += `<td style="font-size:0.75rem;">`;
    if (sessTel) {
      const totalTok = (sessTel.inputTokens || 0) + (sessTel.outputTokens || 0);
      const cost = sessTel.cost || 0;
      if (totalTok > 0 || cost > 0) {
        html += `<span style="color:var(--text-muted);">${totalTok > 0 ? totalTok.toLocaleString() + " tok" : ""}`;
        if (cost > 0) html += ` · $${cost.toFixed(4)}`;
        html += `</span>`;
      } else {
        html += '<span style="color:var(--text-faint);">—</span>';
      }
    } else {
      html += '<span style="color:var(--text-faint);">—</span>';
    }
    html += `</td>`;
    html += `<td><span class="tmux-cmd" data-tmux="${escapeHtml(sess)}" onclick="copyTmuxCmd('${escapeHtml(sess)}')" title="Click to copy">${escapeHtml(cmd)}</span></td>`;
    html += `<td>—</td>`;
    html += `</tr>`;
  }

  html += '</tbody></table>';
  $mergeBody.innerHTML = html;
}

// ─── Render: Errors ─────────────────────────────────────────────────────────

function renderErrors(batch) {
  const errors = batch?.errors || [];
  if (errors.length === 0) {
    $errorsPanel.style.display = "none";
    return;
  }
  $errorsPanel.style.display = "";
  let html = "";
  for (const err of errors.slice(-10)) {
    const msg = typeof err === "string" ? err : err.message || JSON.stringify(err);
    html += `<div class="error-item"><span class="error-bullet">●</span><span class="error-text">${escapeHtml(msg)}</span></div>`;
  }
  $errorsBody.innerHTML = html;
}

// ─── Render: No Batch ───────────────────────────────────────────────────────

let noBatchRendered = false;

function renderNoBatch() {
  if (noBatchRendered) return;
  noBatchRendered = true;

  // Hide repo filter when no batch
  updateRepoFilter([]);

  // Hide live panels, show history panel
  const $lanesPanel = document.getElementById("lanes-tasks-panel");
  const $mergePanel = document.getElementById("merge-panel");
  if ($lanesPanel) $lanesPanel.style.display = "none";
  if ($mergePanel) $mergePanel.style.display = "none";
  if ($errorsPanel) $errorsPanel.style.display = "none";

  // Show a placeholder while history loads. loadHistoryList() (called in
  // render() just before this) is async — the fresh list may not be
  // available yet. The loadHistoryList callback will replace this with
  // the actual latest entry once it resolves.
  if (!viewingHistoryId) {
    $historyBody.innerHTML = `
      <div class="no-batch">
        <div class="no-batch-icon">⏳</div>
        <div class="no-batch-title">Batch complete</div>
        <div class="no-batch-hint">Loading history…</div>
      </div>`;
    $historyPanel.style.display = "";
  }
}

function ensureContentPanels() {
  if (noBatchRendered) {
    // A live batch started — restore panels and reload
    location.reload();
  }
}

// ─── Supervisor Panel ───────────────────────────────────────────────────────

const $supervisorPanel        = $("supervisor-panel");
const $supervisorStatusBadge  = $("supervisor-status-badge");
const $supervisorCollapseBtn  = $("supervisor-collapse-btn");
const $supervisorPanelBody    = $("supervisor-panel-body");
const $supervisorStatusSection       = $("supervisor-status-section");
const $supervisorConversationSection = $("supervisor-conversation-section");
const $supervisorActionsSection      = $("supervisor-actions-section");
const $supervisorSummarySection      = $("supervisor-summary-section");

let supervisorCollapsed = false;

// Toggle collapse on header click
$("supervisor-panel-toggle").addEventListener("click", (e) => {
  // Don't toggle when clicking the collapse button itself (it has its own handler)
  if (e.target.id === "supervisor-collapse-btn") return;
  toggleSupervisorPanel();
});

$supervisorCollapseBtn.addEventListener("click", toggleSupervisorPanel);

function toggleSupervisorPanel() {
  supervisorCollapsed = !supervisorCollapsed;
  $supervisorPanelBody.style.display = supervisorCollapsed ? "none" : "";
  $supervisorCollapseBtn.textContent = supervisorCollapsed ? "▸" : "▾";
}

/** Determine supervisor status from lock data. */
function supervisorStatusInfo(lock) {
  if (!lock) return { status: "inactive", label: "Inactive", cls: "supervisor-inactive" };
  if (lock.stale) return { status: "stale", label: "Stale", cls: "supervisor-stale" };
  return { status: "active", label: "Active", cls: "supervisor-active" };
}

/** Format a timestamp for the supervisor timeline. */
function formatSupervisorTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Render the supervisor status indicator section. */
function renderSupervisorStatus(supervisor) {
  const lock = supervisor.lock;
  const info = supervisorStatusInfo(lock);

  // Update the header badge
  $supervisorStatusBadge.textContent = info.label;
  $supervisorStatusBadge.className = `supervisor-status-badge ${info.cls}`;

  let html = '<div class="supervisor-status-row">';
  html += `<span class="supervisor-status-dot ${info.cls}"></span>`;
  html += `<span class="supervisor-status-label">${info.label}</span>`;

  if (lock) {
    if (lock.autonomy) {
      html += `<span class="supervisor-autonomy-badge">${escapeHtml(lock.autonomy)}</span>`;
    }
    if (lock.heartbeat) {
      html += `<span class="supervisor-heartbeat" title="Last heartbeat">♡ ${relativeTime(lock.heartbeat)}</span>`;
    }
    if (lock.sessionId) {
      html += `<span class="supervisor-session-id" title="Session: ${escapeHtml(lock.sessionId)}">${escapeHtml(lock.sessionId)}</span>`;
    }
  }

  html += '</div>';
  $supervisorStatusSection.innerHTML = html;
}

/** Render the conversation history section. */
function renderSupervisorConversation(supervisor) {
  const conversation = supervisor.conversation || [];

  if (conversation.length === 0) {
    $supervisorConversationSection.innerHTML = '';
    return;
  }

  let html = '<div class="supervisor-subsection-title">Conversation</div>';
  html += '<div class="supervisor-conversation-list">';

  for (const entry of conversation) {
    const time = formatSupervisorTime(entry.ts || entry.timestamp);
    const role = entry.role || "unknown";
    const content = entry.content || entry.message || "";
    const roleCls = role === "operator" ? "conv-role-operator" : "conv-role-supervisor";
    const roleLabel = role === "operator" ? "Operator" : "Supervisor";

    html += `<div class="supervisor-conv-entry ${roleCls}">`;
    html += `  <div class="supervisor-conv-header">`;
    html += `    <span class="supervisor-conv-role">${roleLabel}</span>`;
    if (time) html += `<span class="supervisor-conv-time">${time}</span>`;
    html += `  </div>`;
    html += `  <div class="supervisor-conv-content">${escapeHtml(content)}</div>`;
    html += `</div>`;
  }

  html += '</div>';
  $supervisorConversationSection.innerHTML = html;
}

/** Merge supervisor actions and Tier 0 recovery events into a unified timeline.
 *  Actions from actions.jsonl and recovery events from events.jsonl are combined
 *  and sorted chronologically (per R002: show both Tier 0 and supervisor actions).
 */
function buildRecoveryTimeline(supervisor) {
  const actions = (supervisor.actions || []).map(a => ({
    ts: a.ts || a.timestamp || 0,
    tier: a.tier,
    type: a.type || a.action || "unknown",
    target: a.target || a.lane || a.taskId || "",
    outcome: a.outcome || a.result || "",
    reason: a.reason || "",
    source: "action"
  }));

  // Include Tier 0 recovery events from events.jsonl
  const events = (supervisor.events || [])
    .filter(e => e.tier === 0 || e.type === "recovery" || e.type === "tier0_recovery")
    .map(e => ({
      ts: e.ts || e.timestamp || 0,
      tier: e.tier != null ? e.tier : 0,
      type: e.type || "event",
      target: e.target || e.lane || e.taskId || "",
      outcome: e.outcome || e.result || "",
      reason: e.reason || e.message || "",
      source: "event"
    }));

  const timeline = [...actions, ...events];
  timeline.sort((a, b) => {
    const tA = typeof a.ts === "string" ? new Date(a.ts).getTime() : a.ts;
    const tB = typeof b.ts === "string" ? new Date(b.ts).getTime() : b.ts;
    return tA - tB;
  });

  return timeline;
}

/** Render the recovery action timeline section. */
function renderSupervisorActions(supervisor) {
  const timeline = buildRecoveryTimeline(supervisor);

  if (timeline.length === 0) {
    $supervisorActionsSection.innerHTML = '';
    return;
  }

  let html = '<div class="supervisor-subsection-title">Recovery Actions</div>';
  html += '<div class="supervisor-timeline">';

  for (const entry of timeline) {
    const time = formatSupervisorTime(entry.ts);
    const tier = entry.tier != null ? `T${entry.tier}` : "";
    const type = entry.type;
    const target = entry.target;
    const outcome = entry.outcome;
    const reason = entry.reason;

    const outcomeCls = outcome === "success" || outcome === "recovered"
      ? "action-success"
      : outcome === "failed" || outcome === "error"
        ? "action-failed"
        : "action-pending";

    html += `<div class="supervisor-action-entry">`;
    html += `  <div class="supervisor-action-left">`;
    html += `    <span class="supervisor-action-time">${time}</span>`;
    html += `    <span class="supervisor-action-dot ${outcomeCls}"></span>`;
    html += `  </div>`;
    html += `  <div class="supervisor-action-right">`;
    html += `    <div class="supervisor-action-header">`;
    if (tier) html += `<span class="supervisor-action-tier">${tier}</span>`;
    html += `      <span class="supervisor-action-type">${escapeHtml(type)}</span>`;
    if (target) html += `<span class="supervisor-action-target">${escapeHtml(target)}</span>`;
    if (outcome) html += `<span class="supervisor-action-outcome ${outcomeCls}">${escapeHtml(outcome)}</span>`;
    html += `    </div>`;
    if (reason) {
      html += `<div class="supervisor-action-reason">${escapeHtml(reason)}</div>`;
    }
    html += `  </div>`;
    html += `</div>`;
  }

  html += '</div>';
  $supervisorActionsSection.innerHTML = html;
}

/** Render the batch summary section (from summary.md). */
function renderSupervisorSummary(supervisor) {
  const summary = supervisor.summary;

  if (!summary) {
    $supervisorSummarySection.innerHTML = '';
    return;
  }

  let html = '<div class="supervisor-subsection-title">Batch Summary</div>';
  html += '<div class="supervisor-summary-content">';
  // Render the summary markdown using the STATUS.md renderer (reuse)
  const { html: renderedMd } = renderStatusMd(summary);
  html += renderedMd;
  html += '</div>';
  $supervisorSummarySection.innerHTML = html;
}

/** Main supervisor panel render function. */
function renderSupervisor(data) {
  const supervisor = data.supervisor;

  if (!supervisor) {
    $supervisorPanel.style.display = "none";
    return;
  }

  $supervisorPanel.style.display = "";

  renderSupervisorStatus(supervisor);
  renderSupervisorConversation(supervisor);
  renderSupervisorActions(supervisor);
  renderSupervisorSummary(supervisor);
}

// ─── Full Render ────────────────────────────────────────────────────────────

// ─── Current data (stored for conversation viewer) ──────────────────────────

let currentData = null;

function render(data) {
  currentData = data;
  const batch = data.batch;
  const tmux = data.tmuxSessions || [];

  $lastUpdate.textContent = new Date().toLocaleTimeString();

  if (!batch) {
    renderHeader(null);
    renderSummary(null);
    renderSupervisor(data);
    // Refresh history list (batch may have just finished)
    if (!noBatchRendered) loadHistoryList();
    renderNoBatch();
    return;
  }

  // Live batch is running — hide history panel, reset viewing state
  if (viewingHistoryId) {
    viewingHistoryId = null;
    $historyPanel.style.display = "none";
    $historySelect.value = "";
  }

  if (noBatchRendered) {
    ensureContentPanels();
    return;
  }

  renderHeader(batch);
  renderSummary(batch);

  // Update repo filter based on current batch data
  const repos = buildRepoSet(batch);
  updateRepoFilter(repos);

  renderSupervisor(data);
  renderLanesTasks(batch, tmux);
  renderMergeAgents(batch, tmux);
  renderErrors(batch);

  const taskCount = (batch.tasks || []).length;
  const laneCount = (batch.lanes || []).length;
  const waveCount = (batch.wavePlan || []).length;
  $footerInfo.textContent = `${taskCount} tasks · ${laneCount} lanes · ${waveCount} waves`;
}

// ─── SSE Connection ─────────────────────────────────────────────────────────

let eventSource = null;
let reconnectTimer = null;

function connect() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource("/api/stream");

  eventSource.onopen = () => {
    $connDot.className = "connection-dot connected";
    $connDot.title = "Connected";
    clearTimeout(reconnectTimer);
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      render(data);
    } catch (err) {
      console.error("Failed to parse SSE data:", err);
    }
  };

  eventSource.onerror = () => {
    $connDot.className = "connection-dot disconnected";
    $connDot.title = "Disconnected — reconnecting…";
    eventSource.close();
    reconnectTimer = setTimeout(connect, 3000);
  };
}

// ─── Viewer Panel (Conversation + STATUS.md) ────────────────────────────────

const $terminalPanel = document.getElementById("terminal-panel");
const $terminalTitle = document.getElementById("terminal-title");
const $terminalBody  = document.getElementById("terminal-body");
const $terminalClose = document.getElementById("terminal-close");
const $autoScrollCheckbox = document.getElementById("auto-scroll-checkbox");
const $autoScrollText = document.getElementById("auto-scroll-text");

// Viewer state
let viewerTimer = null;
let autoScrollOn = false;
let isProgrammaticScroll = false;

// Conversation append-only state
let convRenderedLines = 0;

// STATUS.md diff-and-skip state
let lastStatusMdText = "";

// ── Open conversation viewer ────────────────────────────────────────────────

function viewConversation(sessionName) {
  // Toggle off if already viewing this session
  if (viewerMode === 'conversation' && viewerTarget === sessionName && $terminalPanel.style.display !== 'none') {
    closeViewer();
    return;
  }

  closeViewer();

  viewerMode = 'conversation';
  viewerTarget = sessionName;
  autoScrollOn = true;
  convRenderedLines = 0;

  $terminalTitle.textContent = `Worker Conversation — ${sessionName}`;
  $autoScrollText.textContent = 'Follow feed';
  $autoScrollCheckbox.checked = true;
  $terminalPanel.style.display = '';
  $terminalBody.innerHTML = '<div class="conv-stream"></div>';

  pollConversation();
  viewerTimer = setInterval(pollConversation, 2000);

  $terminalPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function pollConversation() {
  fetch(`/api/conversation/${encodeURIComponent(viewerTarget)}`)
    .then(r => r.text())
    .then(text => {
      if (!text.trim()) {
        if (convRenderedLines === 0) {
          $terminalBody.innerHTML = '<div class="conv-empty">No conversation events yet…</div>';
        }
        return;
      }

      const lines = text.trim().split('\n');

      // File was reset (new task on same lane) — full re-render
      if (lines.length < convRenderedLines) {
        convRenderedLines = 0;
        const container = $terminalBody.querySelector('.conv-stream');
        if (container) container.innerHTML = '';
      }

      // Nothing new
      if (lines.length === convRenderedLines) return;

      // Ensure container exists
      let container = $terminalBody.querySelector('.conv-stream');
      if (!container) {
        $terminalBody.innerHTML = '';
        container = document.createElement('div');
        container.className = 'conv-stream';
        $terminalBody.appendChild(container);
      }

      // Append only new events
      const newLines = lines.slice(convRenderedLines);
      for (const line of newLines) {
        try {
          const event = JSON.parse(line);
          const html = renderConvEvent(event);
          if (html) container.insertAdjacentHTML('beforeend', html);
        } catch { continue; }
      }

      convRenderedLines = lines.length;

      // Auto-scroll to bottom
      if (autoScrollOn) {
        isProgrammaticScroll = true;
        $terminalBody.scrollTop = $terminalBody.scrollHeight;
        requestAnimationFrame(() => { isProgrammaticScroll = false; });
      }
    })
    .catch(() => {});
}

// ── Open STATUS.md viewer ───────────────────────────────────────────────────

function viewStatusMd(taskId) {
  // Toggle off if already viewing this task
  if (viewerMode === 'status-md' && viewerTarget === taskId && $terminalPanel.style.display !== 'none') {
    closeViewer();
    return;
  }

  closeViewer();

  viewerMode = 'status-md';
  viewerTarget = taskId;
  autoScrollOn = false;
  lastStatusMdText = '';

  $terminalTitle.textContent = `STATUS.md — ${taskId}`;
  $autoScrollText.textContent = 'Track progress';
  $autoScrollCheckbox.checked = false;
  $terminalPanel.style.display = '';
  $terminalBody.innerHTML = '<div class="conv-empty">Loading…</div>';

  pollStatusMd();
  viewerTimer = setInterval(pollStatusMd, 2000);

  $terminalPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function pollStatusMd() {
  fetch(`/api/status-md/${encodeURIComponent(viewerTarget)}`)
    .then(r => {
      if (!r.ok) throw new Error('not found');
      return r.text();
    })
    .then(text => {
      // Diff-and-skip: no change, no DOM update
      if (text === lastStatusMdText) return;
      lastStatusMdText = text;

      const { html, hasLastChecked } = renderStatusMd(text);
      $terminalBody.innerHTML = html;

      // Update tracking highlight
      updateTrackingHighlight();

      // Auto-scroll to last checked item
      if (autoScrollOn && hasLastChecked) {
        scrollToLastChecked();
      }
    })
    .catch(() => {
      if (!lastStatusMdText) {
        $terminalBody.innerHTML = '<div class="conv-empty">STATUS.md not found</div>';
      }
    });
}

// ── STATUS.md renderer ──────────────────────────────────────────────────────

function renderStatusMd(markdown) {
  const lines = markdown.split('\n');
  let lastCheckedIdx = -1;

  // First pass: find last checked item
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*\[x\]/i.test(lines[i])) lastCheckedIdx = i;
  }

  let html = '<div class="status-md-content">';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const lvl = Math.min(hMatch[1].length, 4);
      html += `<div class="status-md-h${lvl}">${renderInlineMd(hMatch[2])}</div>`;
      continue;
    }

    // Checked checkbox
    if (/^\s*-\s*\[x\]/i.test(line)) {
      const text = line.replace(/^\s*-\s*\[x\]\s*/i, '');
      const isLast = i === lastCheckedIdx;
      const cls = isLast ? 'status-md-check checked last-checked' : 'status-md-check checked';
      const id = isLast ? ' id="last-checked"' : '';
      html += `<div class="${cls}"${id}><span class="check-box">☑</span><span>${renderInlineMd(text)}</span></div>`;
      continue;
    }

    // Unchecked checkbox
    if (/^\s*-\s*\[\s\]/.test(line)) {
      const text = line.replace(/^\s*-\s*\[\s\]\s*/, '');
      html += `<div class="status-md-check unchecked"><span class="check-box">☐</span><span>${renderInlineMd(text)}</span></div>`;
      continue;
    }

    // List item
    const liMatch = line.match(/^\s*-\s+(.*)/);
    if (liMatch) {
      html += `<div class="status-md-li">• ${renderInlineMd(liMatch[1])}</div>`;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      html += '<div class="status-md-spacer"></div>';
      continue;
    }

    // Plain text
    html += `<div class="status-md-text">${renderInlineMd(line)}</div>`;
  }

  html += '</div>';
  return { html, hasLastChecked: lastCheckedIdx >= 0 };
}

function renderInlineMd(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`(.+?)`/g, '<code class="status-md-code">$1</code>');
  return s;
}

// ── Conversation event renderer ─────────────────────────────────────────────

function renderConvEvent(event) {
  switch (event.type) {
    case "message_update": {
      const delta = event.assistantMessageEvent;
      if (delta?.type === "text_delta" && delta.delta) {
        return `<span class="conv-text">${escapeHtml(delta.delta)}</span>`;
      }
      if (delta?.type === "thinking_delta" && delta.delta) {
        return `<span class="conv-thinking">${escapeHtml(delta.delta)}</span>`;
      }
      return "";
    }

    case "tool_call": {
      const name = event.toolName || "unknown";
      const argsStr = event.args?.path || event.args?.command || "";
      return `<div class="conv-tool-call"><span class="conv-tool-name">🔧 ${escapeHtml(name)}</span> <span class="conv-tool-args">${escapeHtml(String(argsStr).substring(0, 200))}</span></div>`;
    }

    case "tool_execution_start": {
      const name = event.toolName || "unknown";
      const argsStr = event.args?.path || event.args?.command || "";
      return `<div class="conv-tool-call"><span class="conv-tool-name">🔧 ${escapeHtml(name)}</span> <span class="conv-tool-args">${escapeHtml(String(argsStr).substring(0, 200))}</span></div>`;
    }

    case "tool_result": {
      const output = event.output || event.result || "";
      const truncated = String(output).length > 500 ? String(output).substring(0, 500) + "…" : String(output);
      return `<div class="conv-tool-result"><pre>${escapeHtml(truncated)}</pre></div>`;
    }

    case "message_end": {
      const usage = event.message?.usage;
      if (usage) {
        const tokens = usage.totalTokens || (usage.input + usage.output) || 0;
        return `<div class="conv-usage">Tokens: ${tokens.toLocaleString()}</div>`;
      }
      return "";
    }

    default:
      return "";
  }
}

// ── Auto-scroll logic ───────────────────────────────────────────────────────

function scrollToLastChecked() {
  const el = document.getElementById('last-checked');
  if (!el) return;
  isProgrammaticScroll = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { isProgrammaticScroll = false; }, 600);
}

function updateTrackingHighlight() {
  const container = $terminalBody.querySelector('.status-md-content');
  if (container) {
    container.classList.toggle('tracking', autoScrollOn && viewerMode === 'status-md');
  }
}

$autoScrollCheckbox.addEventListener('change', () => {
  autoScrollOn = $autoScrollCheckbox.checked;
  if (autoScrollOn) {
    if (viewerMode === 'conversation') {
      isProgrammaticScroll = true;
      $terminalBody.scrollTop = $terminalBody.scrollHeight;
      requestAnimationFrame(() => { isProgrammaticScroll = false; });
    } else if (viewerMode === 'status-md') {
      scrollToLastChecked();
      updateTrackingHighlight();
    }
  } else {
    updateTrackingHighlight();
  }
});

$terminalBody.addEventListener('scroll', () => {
  if (isProgrammaticScroll) return;

  if (viewerMode === 'conversation') {
    const isAtBottom = $terminalBody.scrollTop + $terminalBody.clientHeight >= $terminalBody.scrollHeight - 30;
    if (isAtBottom && !autoScrollOn) {
      autoScrollOn = true;
      $autoScrollCheckbox.checked = true;
    } else if (!isAtBottom && autoScrollOn) {
      autoScrollOn = false;
      $autoScrollCheckbox.checked = false;
    }
  } else if (viewerMode === 'status-md') {
    if (autoScrollOn) {
      autoScrollOn = false;
      $autoScrollCheckbox.checked = false;
      updateTrackingHighlight();
    }
  }
});

// ── Close viewer ────────────────────────────────────────────────────────────

function closeViewer() {
  if (viewerTimer) {
    clearInterval(viewerTimer);
    viewerTimer = null;
  }
  viewerMode = null;
  viewerTarget = null;
  autoScrollOn = false;
  convRenderedLines = 0;
  lastStatusMdText = '';
  $terminalPanel.style.display = 'none';
  $terminalBody.innerHTML = '';
}

$terminalClose.addEventListener('click', closeViewer);

// Make viewer functions available globally for onclick handlers
window.viewConversation = viewConversation;
window.viewStatusMd = viewStatusMd;

// ─── History ────────────────────────────────────────────────────────────────

/** Fetch the compact history list and populate the dropdown. */
function loadHistoryList() {
  fetch("/api/history")
    .then(r => r.json())
    .then(list => {
      historyList = list || [];
      renderHistoryDropdown();
      // Auto-select the latest history entry when no live batch is running.
      // Always update the view here — renderNoBatch() shows a placeholder
      // while this async fetch completes, so we need to replace it with
      // the actual latest entry. This fixes #20 where the stale cached
      // historyList caused the previous batch to be shown.
      if (noBatchRendered && historyList.length > 0) {
        viewHistoryEntry(historyList[0].batchId);
        $historySelect.value = historyList[0].batchId;
      } else if (noBatchRendered && historyList.length === 0) {
        $historyBody.innerHTML = `
          <div class="no-batch">
            <div class="no-batch-icon">⏳</div>
            <div class="no-batch-title">No batch running</div>
            <div class="no-batch-hint">.pi/batch-state.json not found<br>Start an orchestrator batch to see the dashboard.</div>
          </div>`;
        $historyPanel.style.display = "";
      }
    })
    .catch(() => {});
}

function renderHistoryDropdown() {
  $historySelect.innerHTML = '<option value="">History ▾</option>';
  for (const h of historyList) {
    const d = new Date(h.startedAt);
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const statusIcon = h.status === "completed" ? "✓" : h.status === "partial" ? "⚠" : "✗";
    const label = `${statusIcon} ${dateStr} ${timeStr} — ${h.totalTasks}tasks ${formatDuration(h.durationMs)}`;
    const opt = document.createElement("option");
    opt.value = h.batchId;
    opt.textContent = label;
    $historySelect.appendChild(opt);
  }
}

/** Load and display a specific historical batch. */
function viewHistoryEntry(batchId) {
  if (!batchId) {
    viewingHistoryId = null;
    $historyPanel.style.display = "none";
    return;
  }
  viewingHistoryId = batchId;
  fetch(`/api/history/${encodeURIComponent(batchId)}`)
    .then(r => r.json())
    .then(entry => {
      if (entry.error) {
        $historyBody.innerHTML = `<div class="empty-state">${escapeHtml(entry.error)}</div>`;
      } else {
        renderHistorySummary(entry);
      }
      $historyPanel.style.display = "";
    })
    .catch(() => {
      $historyBody.innerHTML = '<div class="empty-state">Failed to load batch details</div>';
      $historyPanel.style.display = "";
    });
}

/** Render a full batch history summary. */
function renderHistorySummary(entry) {
  const startDate = new Date(entry.startedAt).toLocaleString();
  const endDate = entry.endedAt ? new Date(entry.endedAt).toLocaleString() : "—";
  const tok = entry.tokens || {};
  const totalIn = (tok.input || 0) + (tok.cacheRead || 0);
  let tokenStr = `↑${formatTokens(totalIn)} ↓${formatTokens(tok.output || 0)}`;
  const costStr = formatCost(tok.costUsd || 0);

  let html = `
    <div class="history-header">
      <span class="batch-id">${escapeHtml(entry.batchId)}</span>
      <span class="batch-status ${entry.status}">${entry.status}</span>
      <span class="batch-time">${startDate} → ${endDate}</span>
    </div>

    <div class="history-stats">
      <div class="stat-card">
        <div class="stat-value">${entry.totalTasks}</div>
        <div class="stat-label">Total Tasks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--green)">${entry.succeededTasks}</div>
        <div class="stat-label">Succeeded</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:${entry.failedTasks > 0 ? 'var(--red)' : 'var(--text-muted)'}">${entry.failedTasks}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${entry.totalWaves}</div>
        <div class="stat-label">Waves</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatDuration(entry.durationMs)}</div>
        <div class="stat-label">Duration</div>
      </div>
      <div class="stat-card stat-tokens">
        <div class="stat-value">🪙 ${tokenStr}</div>
        <div class="stat-label">Tokens</div>
      </div>
      ${costStr ? `<div class="stat-card">
        <div class="stat-value" style="color:var(--yellow)">${costStr}</div>
        <div class="stat-label">Cost</div>
      </div>` : ""}
    </div>`;

  // Wave table
  if (entry.waves && entry.waves.length > 0) {
    html += `<div class="history-section-title">Waves</div>`;
    html += `<table class="history-waves-table"><thead><tr>
      <th>Wave</th><th>Tasks</th><th>Merge</th><th>Duration</th><th>Tokens</th><th>Cost</th>
    </tr></thead><tbody>`;
    for (const w of entry.waves) {
      const wTok = w.tokens || {};
      const wTotalIn = (wTok.input || 0) + (wTok.cacheRead || 0);
      let wTokenStr = `↑${formatTokens(wTotalIn)} ↓${formatTokens(wTok.output || 0)}`;
      const mergeClass = w.mergeStatus === "succeeded" ? "status-succeeded" :
        w.mergeStatus === "failed" ? "status-failed" : "status-stalled";
      html += `<tr>
        <td>Wave ${w.wave}</td>
        <td>${w.tasks.join(", ")}</td>
        <td><span class="status-badge ${mergeClass}">${w.mergeStatus}</span></td>
        <td>${formatDuration(w.durationMs)}</td>
        <td>${wTokenStr}</td>
        <td style="color:var(--yellow)">${formatCost(wTok.costUsd || 0)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  // Task table
  if (entry.tasks && entry.tasks.length > 0) {
    html += `<div class="history-section-title">Tasks</div>`;
    html += `<table class="history-tasks-table"><thead><tr>
      <th>Task</th><th>Status</th><th>Wave</th><th>Lane</th><th>Duration</th><th>Tokens</th><th>Cost</th><th>Exit</th>
    </tr></thead><tbody>`;
    for (const t of entry.tasks) {
      const tTok = t.tokens || {};
      const tTotalIn = (tTok.input || 0) + (tTok.cacheRead || 0);
      let tTokenStr = `↑${formatTokens(tTotalIn)} ↓${formatTokens(tTok.output || 0)}`;
      const statusCls = `status-${t.status}`;
      html += `<tr>
        <td>${escapeHtml(t.taskId)}</td>
        <td><span class="status-badge ${statusCls}">${t.status}</span></td>
        <td>W${t.wave}</td>
        <td>L${t.lane}</td>
        <td>${formatDuration(t.durationMs)}</td>
        <td>${tTokenStr}</td>
        <td style="color:var(--yellow)">${formatCost(tTok.costUsd || 0)}</td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${t.exitReason ? escapeHtml(t.exitReason) : "—"}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  $historyBody.innerHTML = html;
}

/** Handle dropdown change. */
$historySelect.addEventListener("change", (e) => {
  const batchId = e.target.value;
  if (batchId) {
    viewHistoryEntry(batchId);
  } else {
    // Switched to "History ▾" — go back to live view or latest
    viewingHistoryId = null;
    $historyPanel.style.display = "none";
  }
});

// ─── Boot ───────────────────────────────────────────────────────────────────

connect();
loadHistoryList();

// One-shot fetch on load (in case SSE is slow to connect)
fetch("/api/state")
  .then(r => r.json())
  .then(render)
  .catch(() => {});
