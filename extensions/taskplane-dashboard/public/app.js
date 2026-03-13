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

function relativeTime(epochMs) {
  if (!epochMs) return "";
  const diff = Date.now() - epochMs;
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

// ─── History State ──────────────────────────────────────────────────────────

let historyList = [];  // compact batch summaries
let viewingHistoryId = null; // batchId if viewing history, null if live

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
    for (const tid of taskIds) {
      const t = taskMap.get(tid);
      if (t && t.statusData) {
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
    return { waveIdx, taskIds, checked: wChecked, total: wTotal };
  });

  const overallPct = batchTotal > 0 ? Math.round((batchChecked / batchTotal) * 100) : 0;
  $overallPct.textContent = `${overallPct}%`;

  // Build segmented progress bar — each wave gets a proportional segment
  let barHtml = "";
  for (const ws of waveStats) {
    const segWidthPct = batchTotal > 0 ? (ws.total / batchTotal) * 100 : (100 / waveStats.length);
    const fillPct = ws.total > 0 ? (ws.checked / ws.total) * 100 : 0;
    const isDone = ws.checked === ws.total && ws.total > 0;
    const isCurrent = ws.waveIdx === currentWaveIdx && batch.phase === "executing";
    const isFuture = ws.waveIdx > currentWaveIdx && batch.phase === "executing";

    const fillClass = isDone ? "pct-hi" : fillPct > 50 ? "pct-mid" : fillPct > 0 ? "pct-low" : "pct-0";
    const segClass = isCurrent ? "wave-seg-current" : isFuture ? "wave-seg-future" : "";

    barHtml += `<div class="wave-seg ${segClass}" style="width:${segWidthPct.toFixed(1)}%" title="W${ws.waveIdx + 1}: ${ws.checked}/${ws.total} checkboxes (${ws.taskIds.join(', ')})">`;
    barHtml += `  <div class="wave-seg-fill ${fillClass}" style="width:${fillPct.toFixed(1)}%"></div>`;
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
  let batchInput = 0, batchOutput = 0, batchCacheRead = 0, batchCacheWrite = 0, batchCost = 0;
  for (const ls of Object.values(laneStates)) {
    batchInput += ls.workerInputTokens || 0;
    batchOutput += ls.workerOutputTokens || 0;
    batchCacheRead += ls.workerCacheReadTokens || 0;
    batchCacheWrite += ls.workerCacheWriteTokens || 0;
    batchCost += ls.workerCostUsd || 0;
  }
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
  let html = "";

  for (const lane of batch.lanes) {
    const alive = tmuxSet.has(lane.tmuxSessionName);
    const tmuxCmd = `tmux attach -t ${lane.tmuxSessionName}`;

    // Lane header
    html += `<div class="lane-group">`;
    html += `<div class="lane-header">`;
    html += `  <span class="lane-num">${lane.laneNumber}</span>`;
    html += `  <div class="lane-meta">`;
    html += `    <span class="lane-session">${escapeHtml(lane.tmuxSessionName || "—")}</span>`;
    html += `    <span class="lane-branch">${escapeHtml(lane.branch || "—")}</span>`;
    html += `  </div>`;
    html += `  <div class="lane-right">`;
    html += `    <span class="tmux-dot ${alive ? "alive" : "dead"}" title="${alive ? "tmux alive" : "tmux dead"}"></span>`;
    // View button: shows conversation stream if available, else tmux pane
    html += `    <button class="tmux-view-btn" onclick="viewConversation('${escapeHtml(lane.tmuxSessionName)}')" title="View worker conversation">👁 View</button>`;
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

    // Get lane state for worker stats
    const ls = laneStates[lane.tmuxSessionName] || null;

    for (const task of laneTasks) {
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

      // Worker stats from lane state sidecar — only show for the active (running) task
      let workerHtml = "";
      if (ls && ls.workerStatus === "running" && task.status === "running") {
        const elapsed = ls.workerElapsed ? `${Math.round(ls.workerElapsed / 1000)}s` : "";
        const tools = ls.workerToolCount || 0;
        const ctx = ls.workerContextPct ? `${Math.round(ls.workerContextPct)}%` : "";
        const lastTool = ls.workerLastTool || "";
        const tokenStr = tokenSummaryFromLaneState(ls);
        workerHtml = `<div class="worker-stats">`;
        workerHtml += `<span class="worker-stat" title="Worker elapsed">⏱ ${elapsed}</span>`;
        workerHtml += `<span class="worker-stat" title="Tool calls">🔧 ${tools}</span>`;
        if (ctx) workerHtml += `<span class="worker-stat" title="Context window used">📊 ${ctx}</span>`;
        if (tokenStr) workerHtml += `<span class="worker-stat" title="Tokens: input↑ output↓ cacheRead(R) cacheWrite(W)">🪙 ${tokenStr}</span>`;
        if (lastTool) workerHtml += `<span class="worker-stat worker-last-tool" title="Last tool call">${escapeHtml(lastTool)}</span>`;
        workerHtml += `</div>`;
      } else if (ls && ls.workerStatus === "done" && task.status !== "pending") {
        workerHtml = `<div class="worker-stats"><span class="worker-stat" style="color:var(--green)">✓ Worker done</span></div>`;
      } else if (ls && ls.workerStatus === "error" && task.status !== "pending") {
        workerHtml = `<div class="worker-stats"><span class="worker-stat" style="color:var(--red)">✗ Worker error</span></div>`;
      }

      html += `
        <div class="task-row">
          <span class="task-icon"><span class="status-dot ${task.status}"></span></span>
          <span class="task-id status-${task.status}">${escapeHtml(task.taskId)}</span>
          <span><span class="status-badge status-${task.status}"><span class="status-dot ${task.status}"></span> ${task.status}</span></span>
          <span class="task-duration">${dur}</span>
          <span>${progressHtml}</span>
          <span class="task-step">${stepHtml}${workerHtml}</span>
        </div>`;
    }

    html += `</div>`; // close lane-group
  }

  $lanesTasksBody.innerHTML = html;
}

// ─── Render: Merge Agents ───────────────────────────────────────────────────

function renderMergeAgents(batch, tmuxSessions) {
  const mergeResults = batch?.mergeResults || [];
  const tmuxSet = new Set(tmuxSessions || []);

  // Check for active merge sessions (convention: orch-merge-*)
  const mergeSessions = (tmuxSessions || []).filter(s => s.startsWith("orch-merge"));

  if (mergeResults.length === 0 && mergeSessions.length === 0) {
    $mergeBody.innerHTML = '<div class="empty-state">No merge agents active</div>';
    return;
  }

  let html = '<table class="merge-table"><thead><tr>';
  html += '<th>Wave</th><th>Status</th><th>Session</th><th>Attach</th><th>Details</th>';
  html += '</tr></thead><tbody>';

  // Show merge results
  for (const mr of mergeResults) {
    const statusCls = mr.status === "succeeded" ? "status-succeeded"
      : mr.status === "partial" ? "status-stalled"
      : "status-failed";

    // Look for matching tmux session
    const sessionName = `orch-merge-w${mr.waveIndex + 1}`;
    const alive = tmuxSet.has(sessionName);

    html += `<tr>`;
    html += `<td style="font-family:var(--font-mono);">Wave ${mr.waveIndex + 1}</td>`;
    html += `<td><span class="status-badge ${statusCls}">${mr.status}</span></td>`;
    html += `<td style="font-family:var(--font-mono);font-size:0.8rem;">${alive ? escapeHtml(sessionName) : "—"}</td>`;
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
  }

  // Show active merge sessions not yet in results
  for (const sess of mergeSessions) {
    const alreadyShown = mergeResults.some((mr) => `orch-merge-w${mr.waveIndex + 1}` === sess);
    if (alreadyShown) continue;

    const cmd = `tmux attach -t ${sess}`;
    html += `<tr>`;
    html += `<td style="font-family:var(--font-mono);">—</td>`;
    html += `<td><span class="status-badge status-running"><span class="status-dot running"></span> merging</span></td>`;
    html += `<td style="font-family:var(--font-mono);font-size:0.8rem;">${escapeHtml(sess)}</td>`;
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

  // Hide live panels, show history panel
  const $lanesPanel = document.getElementById("lanes-tasks-panel");
  const $mergePanel = document.getElementById("merge-panel");
  if ($lanesPanel) $lanesPanel.style.display = "none";
  if ($mergePanel) $mergePanel.style.display = "none";
  if ($errorsPanel) $errorsPanel.style.display = "none";

  // Try to show the latest history entry
  if (historyList.length > 0 && !viewingHistoryId) {
    viewHistoryEntry(historyList[0].batchId);
    $historySelect.value = historyList[0].batchId;
  } else if (historyList.length === 0) {
    // No history yet — show placeholder in the history panel
    $historyBody.innerHTML = `
      <div class="no-batch">
        <div class="no-batch-icon">⏳</div>
        <div class="no-batch-title">No batch running</div>
        <div class="no-batch-hint">.pi/batch-state.json not found<br>Start an orchestrator batch to see the dashboard.</div>
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

// ─── Terminal Viewer ─────────────────────────────────────────────────────────

const $terminalPanel = document.getElementById("terminal-panel");
const $terminalTitle = document.getElementById("terminal-title");
const $terminalBody  = document.getElementById("terminal-body");
const $terminalClose = document.getElementById("terminal-close");

let activeSession = null;
let conversationTimer = null;

function viewConversation(sessionName) {
  if (activeSession === sessionName && $terminalPanel.style.display !== "none") return;

  closeConversation();

  activeSession = sessionName;
  $terminalTitle.textContent = `Worker Conversation — ${sessionName}`;
  $terminalPanel.style.display = "";

  // Initial load + start polling
  loadConversation(sessionName);
  conversationTimer = setInterval(() => loadConversation(sessionName), 2000);

  $terminalPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function loadConversation(sessionName) {
  fetch(`/api/conversation/${encodeURIComponent(sessionName)}`)
    .then(r => r.text())
    .then(text => renderConversation(text))
    .catch(() => {});
}

function renderConversation(jsonlText) {
  if (!jsonlText.trim()) {
    $terminalBody.innerHTML = '<div class="conv-empty">No conversation events yet…</div>';
    return;
  }

  const lines = jsonlText.trim().split("\n");
  let html = '<div class="conv-stream">';

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      html += renderConvEvent(event);
    } catch { continue; }
  }

  html += '</div>';

  // Preserve scroll position if already scrolled up
  const wasAtBottom = $terminalBody.scrollTop + $terminalBody.clientHeight >= $terminalBody.scrollHeight - 20;
  $terminalBody.innerHTML = html;
  if (wasAtBottom) {
    $terminalBody.scrollTop = $terminalBody.scrollHeight;
  }
}

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

function closeConversation() {
  if (conversationTimer) {
    clearInterval(conversationTimer);
    conversationTimer = null;
  }
  activeSession = null;
  $terminalPanel.style.display = "none";
  $terminalBody.innerHTML = "";
}

$terminalClose.addEventListener("click", closeConversation);

// Make viewConversation available globally for onclick handlers
window.viewConversation = viewConversation;

// ─── History ────────────────────────────────────────────────────────────────

/** Fetch the compact history list and populate the dropdown. */
function loadHistoryList() {
  fetch("/api/history")
    .then(r => r.json())
    .then(list => {
      historyList = list || [];
      renderHistoryDropdown();
      // If no live batch and no history shown yet, auto-select latest
      if (noBatchRendered && !viewingHistoryId && historyList.length > 0) {
        viewHistoryEntry(historyList[0].batchId);
        $historySelect.value = historyList[0].batchId;
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
