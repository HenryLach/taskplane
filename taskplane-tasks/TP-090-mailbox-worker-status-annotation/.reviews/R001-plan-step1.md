## Plan Review: Step 1 — Steering-pending flag and STATUS.md injection

### Verdict: REVISE

### Summary
Good direction overall, but the current Step 1 plan still has a few contract gaps that will cause implementation ambiguity. The biggest issue is path ownership: `rpc-wrapper.mjs` currently has no reliable way to locate the task folder, so the plan needs explicit threading for where `.steering-pending` is written. A second gap is file format definition ("timestamp + content" is too vague for deterministic parsing).

### Blocking Issues

1. **Missing path contract from task-runner → rpc-wrapper**
   - `spawnAgentTmux()` currently passes `--mailbox-dir`, but no task-folder/flag-file path.
   - `rpc-wrapper` reads prompt from temp files (`/tmp/pi-task-prompt-*`), so it cannot safely infer task folder.
   - **Required plan update:** add an explicit CLI arg (e.g., `--steering-pending-path <abs-path>` or `--task-folder <abs-path>`), and thread it from `runWorker()`/`spawnAgentTmux()`.

2. **Worker-only scoping is not explicit**
   - STATUS annotation is worker-only per spec; reviewer/merger should not write worker task flags.
   - **Required plan update:** ensure only worker spawns receive the steering-pending path arg.

3. **`.steering-pending` on-disk format is underspecified**
   - “append timestamp + content” is not enough to implement deterministic parse/recovery.
   - **Required plan update:** define exact format (recommended JSONL with one record per delivered message, including timestamp + content, optionally id), newline-delimited, append-only.

4. **Polling-loop insertion point needs precision**
   - In `executeTask()`, there is an early `state.phase === "error"` return after `runWorker()`.
   - **Required plan update:** annotate steering entries before that return path so delivered messages are not dropped on failed iterations.

### Important (non-blocking) suggestions

- **Escape/sanitize message content for markdown tables** before writing `| ... | ... | ... |` rows (at minimum collapse newlines and escape `|`) to avoid corrupting STATUS table rendering.
- In Step 2 tests, cover both halves of the contract:
  - rpc-wrapper writes `.steering-pending` entries when deliveries occur
  - task-runner consumes entries, appends `⚠️ Steering` log rows, then deletes flag file

### What to add to Step 1 checklist before implementation

- [ ] Thread explicit steering-pending file path from task-runner spawn to rpc-wrapper
- [ ] Restrict steering-pending write to worker sessions only
- [ ] Define `.steering-pending` wire format (JSONL schema + append semantics)
- [ ] Define exact loop placement for annotation (pre-error-return)
- [ ] Define content sanitization rule for STATUS execution log row