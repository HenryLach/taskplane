# TP-157: Consolidate npm/package path resolution into path-resolver.ts — Status

**Current Step:** Step 1: Create extensions/taskplane/path-resolver.ts
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Done

- [x] Read all three source files and catalog every path resolution function
- [x] Verify test suite baseline

---

### Step 1: Create extensions/taskplane/path-resolver.ts
**Status:** 🟨 In Progress

- [ ] Implement `getNpmGlobalRoot()` — cached, ESM-safe, shell:true for Windows
- [ ] Implement `resolvePiCliPath()` — dynamic-first, all platforms, clear error
- [ ] Implement `resolveTaskplanePackageFile()` — dynamic-first, local dev fallback
- [ ] Implement `resolveTaskplaneAgentTemplate()` — convenience wrapper
- [ ] Add JSDoc with platform notes to all exports

---

### Step 2: Refactor callers to use path-resolver.ts
**Status:** ⬜ Not Started

- [ ] `execution.ts` — remove local functions, import from path-resolver.ts
- [ ] `agent-host.ts` — remove local functions, import from path-resolver.ts
- [ ] `agent-bridge-extension.ts` — remove local functions, import from path-resolver.ts
- [ ] Verify no other files import removed functions directly

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke checks passing
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] JSDoc file header on path-resolver.ts
- [ ] Check AGENTS.md and development-setup.md for affected references
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `loadReviewerPrompt` in agent-bridge-extension.ts uses `join("taskplane", relPath)` with the npm root directly (not via resolveTaskplanePackageFile), but final paths are equivalent | Handled in refactor — use resolveTaskplaneAgentTemplate which goes through resolveTaskplanePackageFile | agent-bridge-extension.ts:399 |
| `getNpmGlobalRoot` in agent-bridge-extension.ts is nested inside `export default function(pi)` block (locally scoped, not module-level) | Can be replaced by importing from path-resolver.ts | agent-bridge-extension.ts:362 |
| `loadBaseAgentPrompt` and `loadReviewerPrompt` stay in their source files — only path resolution logic moves to path-resolver.ts | No behavioral change needed, just use resolveTaskplaneAgentTemplate for the path | execution.ts:2128, agent-bridge-extension.ts:399 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 00:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 00:05 | Step 0 started | Preflight |
| 2026-04-11 00:06 | Snapshot refresh disabled | Lane 1, task TP-157: 5 consecutive emitSnapshot failures |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
