# TP-101: Refresh create-taskplane-task Skill for Runtime V2 — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read the current skill, prompt template, and AGENTS/config guidance
- [ ] Identify every place the skill still assumes `/task`, TMUX, `PROGRESS.md`, or YAML-first config behavior

---

### Step 1: Update Skill Workflow and Guidance
**Status:** ⬜ Not Started

- [ ] Switch the skill guidance to JSON config precedence while preserving fallback notes only where necessary
- [ ] Replace `/task` launch/reporting guidance with `/orch`-based execution guidance
- [ ] Remove TMUX-centric phrasing from the skill's architecture and workflow sections
- [ ] Remove `PROGRESS.md` as a required tracking artifact for this project/workflow

---

### Step 2: Update Templates and References
**Status:** ⬜ Not Started

- [ ] Refresh the prompt/status template language so it does not imply `/task` is the canonical runtime path
- [ ] Align command references, task-creation checklists, and examples with Runtime V2 direction
- [ ] Review user-facing docs touched by the skill for consistency

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Verify markdown links and file references in the updated skill and templates
- [ ] Run CLI smoke checks
- [ ] Run the full suite if shipped behavior/docs changed beyond the skill itself

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Document any deliberate interim compatibility wording while Runtime V2 is still under construction
- [ ] Log discoveries in STATUS.md

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
