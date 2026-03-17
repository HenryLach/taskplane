# TP-017: User Preferences Layer — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Confirm path convention: resolve `PI_CODING_AGENT_DIR` override, cross-platform home dir, and document decision in Discoveries

---

### Step 1: Implement Preferences Loader
**Status:** ⬜ Not Started

- [ ] Preferences schema defined
- [ ] `loadUserPreferences()` implemented with auto-creation
- [ ] Merge logic with project config correct

---

### Step 2: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Tests for loading, auto-creation, and merge
- [ ] `cd extensions && npx vitest run`

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **Preferences path resolution**: Base dir = `PI_CODING_AGENT_DIR` env (if set), else `os.homedir() + '.pi/agent'`. Preferences at `<base>/taskplane/preferences.json`. Use `os.homedir()` for cross-platform home resolution (USERPROFILE on Windows, HOME on Unix) + `path.join()` for separators. Implement as shared `resolveUserPreferencesPath()` helper in `config-loader.ts`. | Decided — implement in Step 1 | `extensions/taskplane/config-loader.ts` |
| **No existing agent-dir helper in codebase**: Taskplane has no helper to resolve the pi agent directory. The new helper will be the first. If pi later exports one, we can switch. | Noted | N/A |
| **Step 2 test plan**: Include test for `PI_CODING_AGENT_DIR` override behavior (mock env var, verify path changes). | Plan for Step 2 | `extensions/tests/` |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 15:23 | Task started | Extension-driven execution |
| 2026-03-17 15:23 | Step 0 started | Preflight |
| 2026-03-17 15:23 | Task started | Extension-driven execution |
| 2026-03-17 15:23 | Step 0 started | Preflight |
| 2026-03-17 15:25 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 15:25 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
