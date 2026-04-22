# TP-110: Runtime V2 Assumption Lab — Status

**Current Step:** Complete
**Status:** ✅ Complete
**Last Updated:** 2026-03-30
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Confirm the local environment can invoke `pi` directly
- [x] Define the minimum viable assumption matrix and success criteria before writing the harness

---

### Step 1: Build the Lab Harness
**Status:** ✅ Complete

- [x] Create standalone scripts under `scripts/runtime-v2-lab/` for direct child spawn, RPC event capture, and mailbox injection experiments
- [x] Keep the harness independent from TMUX and the current `/task` production path
- [x] Make the harness cheap to run repeatedly with tiny prompts and bounded iterations

---

### Step 2: Run Core Assumption Experiments
**Status:** ✅ Complete

- [x] Run direct-spawn reliability experiments (sequential and limited parallel)
- [x] Run direct-host RPC event/usage capture experiments
- [x] Run mailbox steering experiments without TMUX
- [x] Run at least one explicit packet-path / `cwd != packet home` experiment
- [x] If feasible within the harness, run one minimal bridge-style request/response experiment

---

### Step 3: Analyze and Document Results
**Status:** ✅ Complete

- [x] Write a durable report summarizing environment, experiment design, results, and interpretation
- [x] Record which Runtime V2 assumptions are validated, partially validated, or still open
- [x] Record recommended adjustments to the implementation roadmap before TP-102+ proceeds

---

### Step 4: Verification & Delivery
**Status:** ✅ Complete

- [x] Re-run the harness after any fixes to confirm the final conclusions
- [x] Ensure the report references concrete script paths and captured evidence
- [x] Log discoveries in STATUS.md and mark the task complete

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Direct child Pi RPC hosting is viable without TMUX for simple prompts and small parallelism on this Windows machine | Validated in harness; proceed with TP-102/103/104 | scripts/runtime-v2-lab/out/latest-summary.json |
| Mailbox steering works without TMUX when injected via RPC `steer` at message boundaries | Validated in harness; keep mailbox-first control model | docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md |
| Packet-home path handling is still open in a reproducible harness run | Keep packet-path contracts early, but require dedicated proof during Runtime V2 execution work | docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md |
| Bridge-style callback semantics remain open and need explicit proof work | Carry forward into TP-105/TP-106 instead of assuming solved | docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-30 | Task started | Preflight and lab setup initiated |
| 2026-03-30 | Harness built | Added standalone scripts under `scripts/runtime-v2-lab/` |
| 2026-03-30 | Assumption experiments run | Direct host, telemetry, mailbox, packet-path, and bridge feasibility probes executed |
| 2026-03-30 | Report written | Results captured in `docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md` |
| 2026-03-30 | Task complete | Final harness rerun and conclusions recorded |

---

## Blockers

*None*

---

## Notes

*Session-attached but resumable is the baseline assumption for Runtime V2 in this lab.*
*The lab justified proceeding with TP-102/103/104, while leaving packet-path reproducibility and bridge callbacks as explicit open risks.*
