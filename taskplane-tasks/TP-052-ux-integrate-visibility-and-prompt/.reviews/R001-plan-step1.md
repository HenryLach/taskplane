# R001 — Plan Review (Step 1: Make `/orch-integrate` obvious after batch completion)

## Verdict
**Changes requested** — good direction, but Step 1 is not fully closed against the stated requirement yet.

## Reviewed artifacts
- `taskplane-tasks/TP-052-ux-integrate-visibility-and-prompt/PROMPT.md`
- `taskplane-tasks/TP-052-ux-integrate-visibility-and-prompt/STATUS.md`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/tests/supervisor.test.ts`

## What’s good
- Engine completion banner now has prominent integrate guidance and explicit commands (`messages.ts:52-65`).
- Routing-mode post-batch context in extension includes explicit `/orch-integrate` and `--pr` suggestions in both `/orch` and `/orch-resume` terminal handlers (`extension.ts:1583-1590`, `extension.ts:1925-1932`).

## Blocking findings

### 1) Legacy manual guidance still points to raw git commands, not `/orch-integrate`
`ORCH_MESSAGES.orchIntegrationManual` still instructs:
- `git log ...`
- `git merge ...`

(`messages.ts:155-160`)

That message is still emitted in both engine and resume manual-mode terminal paths:
- `engine.ts:2026-2029`
- `resume.ts:2125-2128`

This creates conflicting UX and undermines the “make `/orch-integrate` obvious” goal.

### 2) Supervisor batch-complete summary still lacks integrate next-step guidance
`formatEventNotification(... batch_complete ...)` currently returns only summary stats (`supervisor.ts:3442-3452`) without `/orch-integrate` guidance.

Step 1 requirement explicitly calls out including guidance in the supervisor’s batch summary. The routing transition message helps, but the proactive batch-complete summary path remains unguided.

### 3) Step 1 has no test updates yet
Step 1 is marked complete in status (`STATUS.md:24-30`), but no tests currently assert the new integrate guidance behavior in:
- engine completion messaging,
- supervisor batch-complete messaging,
- resumed-batch completion path consistency.

## Required plan updates before marking Step 1 done
1. **Unify/replace legacy manual guidance** so all post-batch guidance points to `/orch-integrate` (and `--pr`), not direct `git merge` commands.
2. **Add supervisor summary guidance** in `batch_complete` notification path (or document and enforce a single authoritative supervisor completion message path).
3. **Add tests** for Step 1 messaging:
   - `ORCH_MESSAGES.orchBatchComplete` includes both commands,
   - supervisor `batch_complete` message includes integrate next-step guidance,
   - manual-mode resume/engine paths do not regress to git-only guidance.

## Non-blocking notes
- Duplicate completed-batch context strings in `extension.ts` (`/orch` and `/orch-resume` terminal callbacks) are now very similar; consider extracting a shared formatter to prevent drift.
- `STATUS.md` header still says `Current Step: Step 0` while Step 1 is marked complete (`STATUS.md:3`, `STATUS.md:25`).