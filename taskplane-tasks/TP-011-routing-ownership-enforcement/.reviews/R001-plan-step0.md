# R001 — Plan Review (Step 0: Add strict-routing policy controls)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-011-routing-ownership-enforcement/PROMPT.md`
- `taskplane-tasks/TP-011-routing-ownership-enforcement/STATUS.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/config.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/discovery-routing.test.ts`

## Blocking findings

### 1) Step 0 is still not hydrated to implementation-level work
`STATUS.md` Step 0 still contains only the two prompt bullets (`STATUS.md:19-20`).

For this task, Step 0 needs concrete units for:
- config schema + defaults,
- loader/type changes,
- discovery policy contract,
- warning vs fatal classification,
- targeted tests.

### 2) Policy surface is undefined (config location, keys, defaults)
The plan does not specify where strict-routing policy lives or how it is configured.

This is currently ambiguous against existing code structure:
- `OrchestratorConfig` has no routing-policy section (`extensions/taskplane/types.ts:10`)
- `loadOrchestratorConfig()` only merges known sections (`extensions/taskplane/config.ts:18-67`)
- discovery routing currently relies on fixed precedence and no policy input (`extensions/taskplane/discovery.ts:882-946`)

Without an explicit config contract, Step 1 enforcement cannot be deterministic.

### 3) “Warning/error behavior” is not operationally defined
The plan says to define warning/error behavior, but it does not specify:
- what condition counts as “missing ownership declaration”,
- which discovery error code(s) represent that condition,
- when that condition is fatal vs warning,
- where operator remediation messaging is surfaced.

This is critical because severity handling is centralized and consumed in multiple places:
- `FATAL_DISCOVERY_CODES` (`extensions/taskplane/types.ts:385`)
- `/orch-plan` fatal gate (`extensions/taskplane/extension.ts:271-281`)
- `/orch` fatal gate (`extensions/taskplane/engine.ts:105-118`)

### 4) Step 0 plumbing path is not planned
If Step 0 introduces policy controls, the plan must explicitly say how policy reaches discovery.

Today `runDiscovery()` options include dependency/cache/workspace config only (`extensions/taskplane/discovery.ts:489-493`), so policy threading is unresolved.

### 5) No Step 0 test plan
No concrete tests are listed for the new policy controls. At minimum, Step 0 should define tests for:
- default permissive behavior,
- strict mode config parsing/defaulting,
- warning vs fatal classification behavior,
- repo-mode non-regression.

## Required plan updates before implementation
1. Hydrate Step 0 in `STATUS.md` into file-level checklist items.
2. Specify policy schema exactly (file, YAML keys, allowed values, defaults, workspace-only applicability).
3. Define the ownership-declaration contract explicitly (e.g., prompt-only vs prompt+area; treatment of default fallback).
4. Define discovery error/severity mapping and where fatal classification is wired.
5. Define operator-facing remediation text path (prefer shared template in `messages.ts` over duplicated literals).
6. Add explicit Step 0 test matrix and target test files.

## Non-blocking note
- `STATUS.md` execution log still has duplicate "Task started" / "Step 0 started" rows (`STATUS.md:74-77`).
