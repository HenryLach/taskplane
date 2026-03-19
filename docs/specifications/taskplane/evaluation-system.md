# Evaluation System — Design Document

**Status:** Draft
**Date:** 2026-03-15

---

## 1. Problem Statement

Taskplane tasks already include unit and integration testing steps — each task's
PROMPT.md prescribes tests that verify the task's own deliverables. This gives us
**local correctness** for individual tasks.

What's missing is **cross-task validation** — verifying that the combined output
of multiple tasks works as an integrated system. When an orchestrator batch runs
10+ tasks across several waves, the following failure modes are invisible to
per-task testing:

- Two tasks both modify a shared API contract in incompatible ways
- A frontend task builds against an API shape that a backend task changed
- A database migration in wave 1 breaks assumptions in wave 3 tasks
- Individual features pass unit tests but the application doesn't start
- E2E user flows that span multiple feature areas regress silently

Without a structured evaluation system, these failures are only discovered after
the entire batch completes — or worse, by a human weeks later.

---

## 2. Design Goals

1. **Test-first orchestration.** Success criteria are defined and documented
   *before* tasks execute, not retrofitted after. This is TDD applied at the
   batch level.

2. **Logical evaluation boundaries.** Evaluations fire at meaningful integration
   points — not after every task, and not only at the very end. The system
   identifies where cross-task verification actually matters.

3. **Pluggable evaluation types.** E2E (Playwright/Cypress), API contract
   testing, build verification, type checking, smoke tests, accessibility
   scanning, visual regression, and custom project-specific checks.

4. **Closed remediation loop.** Failed evaluations produce diagnosis →
   remediation tasks → re-execution → re-evaluation, with circuit breakers
   to prevent infinite loops.

5. **File-backed and inspectable.** Evaluation plans, results, and remediation
   history are persistent files — consistent with Taskplane's core philosophy.

6. **Operator visibility.** The evaluation lifecycle is surfaced in the
   dashboard, status commands, and batch history.

---

## 3. Concepts & Terminology

### Eval Plan

A structured document produced *before* batch execution that catalogs:
- **Success criteria** — what "working" means for each task and for the batch
  as a whole
- **Eval gates** — when to evaluate (at which points in the wave plan)
- **Eval suites** — what to run at each gate (test commands, frameworks, checks)

### Eval Gate

A checkpoint in the orchestration timeline where evaluation agents are spawned.
Gates are placed at **wave boundaries** (after merge completes) because that's
when integrated code is available on the integration branch. A gate may span
multiple waves ("evaluate after waves 1–3 all complete").

### Eval Suite

A collection of related checks that run at a gate. Examples:
- Playwright E2E test suite for auth flows
- API contract tests for the billing service
- `tsc --noEmit` full project type check
- `npm run build` build verification
- Custom health-check scripts

### Eval Agent

An AI agent spawned at a gate to execute the eval suites, interpret results,
and produce a structured eval report. Runs against the **integration branch**
(merged code), not individual lane worktrees.

### Remediation Task

A standard Taskplane task (PROMPT.md + STATUS.md) generated when an evaluation
fails. It describes the specific fix needed, references the eval failure, and
enters the orchestration plan as a new wave.

### Remediation Cycle

The feedback loop: eval fails → diagnosis → remediation task(s) → execute →
re-merge → re-evaluate at the same gate. Bounded by `max_retries_per_gate`.

---

## 4. Architecture

### Where it fits

```text
                      ┌────────────────────┐
                      │   /eval-plan       │  ← NEW: generates eval plan
                      └────────┬───────────┘
                               │ reads /orch-plan output + PROMPT.md files
                               ▼
                      ┌────────────────────┐
                      │  EVAL-PLAN.md      │  ← persistent eval plan file
                      │  .pi/eval-plan.json│  ← machine-readable gates
                      └────────┬───────────┘
                               │
           ┌───────────────────┼──────────────────────┐
           │                   │                      │
           ▼                   ▼                      ▼
    ┌─────────────┐   ┌──────────────┐    ┌───────────────────┐
    │  /orch      │   │  /orch       │    │  /orch            │
    │  Wave 1     │   │  Wave 2      │    │  Wave N           │
    │  execute +  │   │  execute +   │    │  execute +        │
    │  merge      │   │  merge       │    │  merge            │
    └──────┬──────┘   └──────┬───────┘    └──────┬────────────┘
           │                 │                   │
           ▼                 ▼                   ▼
    ┌─────────────┐   ┌──────────────┐    ┌───────────────────┐
    │ Eval Gate 1 │   │ Eval Gate 2  │    │ Final Eval Gate   │
    │ (if defined)│   │ (if defined) │    │ (always)          │
    └──────┬──────┘   └──────┬───────┘    └──────┬────────────┘
           │                 │                   │
           ├── pass ──→ continue          ├── pass ──→ batch complete ✅
           │                              │
           └── fail ──→ remediation       └── fail ──→ remediation
                          │                              │
                          ▼                              ▼
                   ┌──────────────┐             ┌──────────────┐
                   │ Remediation  │             │ Remediation  │
                   │ Wave         │             │ Wave         │
                   │ (new tasks)  │             │ (new tasks)  │
                   └──────┬───────┘             └──────┬───────┘
                          │                            │
                          └── re-merge ──→ re-eval     └── re-merge ──→ re-eval
                                (max N retries)              (max N retries)
```

### New modules

| Module | Responsibility |
|--------|---------------|
| `extensions/taskplane/eval-plan.ts` | Eval plan generation, parsing, persistence |
| `extensions/taskplane/eval-execution.ts` | Gate execution, eval agent spawning, result collection |
| `extensions/taskplane/eval-remediation.ts` | Failure diagnosis, remediation task generation, retry logic |
| `extensions/taskplane/eval-types.ts` | Types, interfaces, constants, defaults |
| `.pi/agents/task-evaluator.md` | System prompt for the eval agent |

### Separation of concerns

The evaluation system is a **new layer** that wraps around the existing
orchestration loop. It does NOT modify:
- Task execution (`execution.ts`)
- Wave computation (`waves.ts`)
- Merge flow (`merge.ts`)
- Task runner (`task-runner.ts`)

Instead, it **hooks into** the orchestrator at wave boundaries — the
`executeOrchBatch()` function gains an optional post-merge evaluation step.

---

## 5. Eval Plan Format

The eval plan has two representations:

### 5.1 Human-readable: `EVAL-PLAN.md`

Generated by the eval planner agent, reviewed by the user, and stored in the
task root. This is the "test spec" that defines what success looks like.

```markdown
# Evaluation Plan — Batch 20260315T140000

## Batch Overview

**Scope:** all
**Tasks:** 12 tasks across 4 waves
**Generated from:** /orch-plan all

---

## Success Criteria Catalog

### AUTH-001: Login endpoint
- API returns 200 with valid JWT for correct credentials
- API returns 401 for invalid credentials
- Token contains expected claims (sub, exp, roles)

### AUTH-002: Session middleware
- Protected routes return 401 without token
- Protected routes return 200 with valid token
- Expired tokens are rejected

### FE-001: Login page
- Login form renders and is interactive
- Successful login redirects to dashboard
- Failed login shows error message
- Works on Chrome, Firefox, Safari

### BIL-003: Invoice generation
- Invoice PDF generates with correct line items
- Tax calculations match expected values
- Email delivery triggers on generation

---

## Eval Gates

### Gate 1: Core API Services (after Wave 1)
**Trigger:** Wave 1 merge complete
**Rationale:** Wave 1 delivers all backend API endpoints. Verify they work
before frontend tasks in Wave 2 build against them.

**Suites:**
1. **Build Verification** — `npm run build` passes
2. **Type Check** — `npx tsc --noEmit` passes
3. **API Integration Tests** — `npm run test:api`
4. **Smoke Test** — Start server, hit /health, verify 200

**Success criteria from tasks:** AUTH-001, AUTH-002, BIL-003

### Gate 2: Full Stack Integration (after Wave 3)
**Trigger:** Wave 3 merge complete
**Rationale:** Wave 3 completes frontend features that depend on Wave 1–2
backend work. First point where E2E flows are testable.

**Suites:**
1. **Build Verification** — `npm run build` passes
2. **E2E: Auth Flows** — `npx playwright test tests/e2e/auth/`
3. **E2E: Billing Flows** — `npx playwright test tests/e2e/billing/`
4. **Visual Regression** — `npx playwright test --project=visual`

### Gate F: Final Evaluation (after all waves)
**Trigger:** All waves merged
**Rationale:** Comprehensive regression check before declaring batch success.

**Suites:**
1. **Full E2E Suite** — `npx playwright test`
2. **Full Unit/Integration Suite** — `npm test`
3. **Build + Lint** — `npm run build && npm run lint`
4. **Accessibility Audit** — `npx playwright test --project=a11y`

---

## Remediation Policy

- Max retries per gate: 3
- On max retries exceeded: pause batch for human intervention
- Remediation tasks use review level 2 (plan + code review)
```

### 5.2 Machine-readable: `.pi/eval-plan.json`

Parsed from or generated alongside `EVAL-PLAN.md`. This is what the orchestrator
reads at runtime.

```json
{
  "schemaVersion": 1,
  "batchScope": "all",
  "generatedAt": 1742054400000,
  "generatedFrom": "orch-plan",

  "successCriteria": [
    {
      "taskId": "AUTH-001",
      "criteria": [
        "API returns 200 with valid JWT for correct credentials",
        "API returns 401 for invalid credentials",
        "Token contains expected claims (sub, exp, roles)"
      ]
    }
  ],

  "gates": [
    {
      "gateId": "gate-1",
      "name": "Core API Services",
      "triggerAfterWave": 1,
      "description": "Verify core API services are functional",
      "tasksCovered": ["AUTH-001", "AUTH-002", "BIL-003"],
      "suites": [
        {
          "suiteId": "gate-1-build",
          "name": "Build Verification",
          "type": "command",
          "command": "npm run build",
          "timeoutMinutes": 10,
          "critical": true
        },
        {
          "suiteId": "gate-1-typecheck",
          "name": "Type Check",
          "type": "command",
          "command": "npx tsc --noEmit",
          "timeoutMinutes": 5,
          "critical": true
        },
        {
          "suiteId": "gate-1-api",
          "name": "API Integration Tests",
          "type": "test-runner",
          "framework": "vitest",
          "command": "npm run test:api",
          "timeoutMinutes": 10,
          "critical": true
        },
        {
          "suiteId": "gate-1-smoke",
          "name": "Smoke Test",
          "type": "smoke",
          "command": "npm run smoke-test",
          "timeoutMinutes": 5,
          "critical": false
        }
      ],
      "maxRetries": 3,
      "onFailure": "remediate"
    },
    {
      "gateId": "gate-2",
      "name": "Full Stack Integration",
      "triggerAfterWave": 3,
      "description": "E2E flows spanning backend and frontend",
      "tasksCovered": ["FE-001", "FE-002", "FE-003"],
      "suites": [
        {
          "suiteId": "gate-2-e2e-auth",
          "name": "E2E: Auth Flows",
          "type": "e2e",
          "framework": "playwright",
          "command": "npx playwright test tests/e2e/auth/",
          "timeoutMinutes": 15,
          "critical": true
        }
      ],
      "maxRetries": 3,
      "onFailure": "remediate"
    },
    {
      "gateId": "gate-final",
      "name": "Final Evaluation",
      "triggerAfterWave": -1,
      "description": "Comprehensive regression suite",
      "tasksCovered": [],
      "suites": [
        {
          "suiteId": "gate-final-e2e",
          "name": "Full E2E Suite",
          "type": "e2e",
          "framework": "playwright",
          "command": "npx playwright test",
          "timeoutMinutes": 30,
          "critical": true
        },
        {
          "suiteId": "gate-final-unit",
          "name": "Full Test Suite",
          "type": "test-runner",
          "framework": "vitest",
          "command": "npm test",
          "timeoutMinutes": 15,
          "critical": true
        }
      ],
      "maxRetries": 3,
      "onFailure": "pause"
    }
  ]
}
```

---

## 6. Execution Flow

### 6.1 Pre-execution: eval plan generation

```text
User: /eval-plan all

1. Run /orch-plan internally (discovery, waves, lane assignment)
2. For each task: extract success criteria from PROMPT.md
   - "## Completion Criteria" section
   - "## Steps" testing steps
   - "## Mission" success language
3. Analyze task dependencies and wave groupings
4. Detect project testing infrastructure:
   - package.json scripts (test, test:e2e, test:api, etc.)
   - Config files (playwright.config.ts, vitest.config.ts, cypress.config.ts)
   - Existing test directories and their scope
5. Determine logical eval gates:
   - Natural boundaries: wave merges where dependent features integrate
   - Always include: final gate after all waves
   - Heuristic: group criteria by which tasks must be complete to test them
6. For each gate: select appropriate eval suites from available infrastructure
7. Write EVAL-PLAN.md (human review) + .pi/eval-plan.json (machine consumption)
8. Present summary to user for review/approval
```

### 6.2 During execution: gate evaluation

The orchestrator's wave execution loop gains an evaluation hook:

```text
for each wave W in wave_plan:
    execute wave W (existing: lanes → tasks → merge)

    if eval_plan has gate triggered by wave W:
        run_eval_gate(gate)

        if gate passed:
            continue to next wave
        else:
            enter remediation cycle (see §7)

if eval_plan has final gate:
    run_eval_gate(final_gate)
```

### 6.3 Gate execution detail

```text
run_eval_gate(gate):
    1. Ensure integration branch is checked out and clean
    2. Run environment setup (if configured: start services, seed data)
    3. For each suite in gate.suites (ordered by priority):
        a. Spawn eval agent OR run command directly
        b. Capture stdout/stderr + exit code
        c. Parse structured test output (JUnit XML, JSON reporter, etc.)
        d. Record per-suite pass/fail + details
        e. If suite is critical and failed: short-circuit remaining suites
    4. Tear down environment
    5. Write gate result to .pi/eval-results/<gateId>-attempt-<N>.json
    6. Return aggregate pass/fail
```

### 6.4 Eval agent vs. direct command execution

Not every evaluation needs an AI agent. The system supports two modes:

| Mode | When to use | How it works |
|------|------------|--------------|
| **Direct command** | Deterministic checks: build, typecheck, lint, existing test suites | Run command, check exit code, capture output |
| **Eval agent** | Interpretive checks: visual regression review, exploratory testing, complex multi-step verification | Spawn AI agent with eval prompt, tools, and success criteria |

Direct commands are faster, cheaper, and more deterministic. Eval agents are
reserved for situations where judgment is required — analyzing screenshots,
interpreting ambiguous test output, or performing ad-hoc exploratory verification.

---

## 7. Remediation Loop

### 7.1 Failure diagnosis

When a gate fails, the eval system produces a structured failure report:

```json
{
  "gateId": "gate-2",
  "attempt": 1,
  "status": "failed",
  "timestamp": 1742054400000,
  "suiteResults": [
    {
      "suiteId": "gate-2-e2e-auth",
      "status": "failed",
      "duration": 45000,
      "totalTests": 12,
      "passed": 10,
      "failed": 2,
      "failures": [
        {
          "testName": "login flow > should redirect to dashboard after login",
          "error": "Expected URL to contain '/dashboard', got '/login'",
          "stackTrace": "...",
          "screenshot": ".pi/eval-results/gate-2/screenshots/login-redirect-fail.png"
        },
        {
          "testName": "login flow > should show error on invalid credentials",
          "error": "Element '.error-message' not found within 5000ms",
          "stackTrace": "..."
        }
      ]
    }
  ]
}
```

### 7.2 Remediation task generation

A **remediation planner agent** analyzes the failure report against the
original tasks and produces remediation tasks:

```text
1. Read eval failure report
2. Read original PROMPT.md files for the tasks covered by this gate
3. Read the actual code changes (git diff from integration branch)
4. Diagnose root cause:
   - Is it a missing implementation? → remediation task to implement
   - Is it a wrong implementation? → remediation task to fix
   - Is it a test environment issue? → remediation task to fix setup
   - Is it a test itself that's wrong? → remediation task to fix test
   - Is it a merge artifact? → remediation task to resolve
5. Generate PROMPT.md + STATUS.md for each remediation task
   - Reference the original task and eval failure
   - Include relevant error output, screenshots, stack traces
   - Scope the fix narrowly (prefer S/M tasks)
6. Place remediation tasks in a staging area
```

### 7.3 Remediation execution

```text
1. Remediation tasks enter a new "remediation wave"
   - Wave number: W.R (e.g., Wave 2.1 = first remediation after wave 2)
   - Dependencies: none (they fix already-merged code)
2. Orchestrator executes remediation wave normally:
   - Lane allocation
   - Worktree isolation
   - Task execution
   - Merge back to integration branch
3. Re-run the same eval gate
4. If pass: continue to next wave
5. If fail: check retry count
   - Under max_retries: loop to step 7.2 with updated failure report
   - At max_retries: pause batch for human intervention
```

### 7.4 Circuit breakers

| Breaker | Default | Behavior on trigger |
|---------|---------|-------------------|
| `max_retries_per_gate` | 3 | Pause batch, notify operator |
| `max_remediation_tasks_per_gate` | 5 | Pause batch — scope creep signal |
| `max_total_remediation_waves` | 10 | Abort batch — systemic failure |
| `eval_timeout_minutes` | 30 | Fail gate, count as attempt |

---

## 8. Configuration

### 8.1 New config section in `task-orchestrator.yaml`

```yaml
evaluation:
  # Master switch
  enabled: false

  # Auto-generate eval plan when /orch starts (if no plan exists)
  auto_plan: false

  # Path to eval plan file (relative to repo root)
  plan_file: "EVAL-PLAN.md"

  # Where machine-readable plan/results are stored
  state_dir: ".pi/eval"

  # Default max retries per gate before pausing
  max_retries_per_gate: 3

  # Max remediation tasks a single gate failure can spawn
  max_remediation_tasks_per_gate: 5

  # Max total remediation waves across entire batch
  max_total_remediation_waves: 10

  # Timeout for a single eval gate execution (minutes)
  gate_timeout_minutes: 30

  # How to handle final gate failure
  on_final_gate_failure: "pause"  # "pause" | "fail"

  # Environment setup/teardown commands
  environment:
    setup: []       # Commands to run before eval (e.g., "docker compose up -d")
    teardown: []    # Commands to run after eval (e.g., "docker compose down")
    health_check:
      command: ""   # Command to verify env is ready (e.g., "curl -f http://localhost:3000/health")
      timeout: 60   # Seconds to wait for health check
      interval: 5   # Seconds between retries

  # Known test frameworks (auto-detected or explicit)
  frameworks:
    playwright:
      config: "playwright.config.ts"
      results_dir: "test-results"
      reporter: "json"
    vitest:
      config: "vitest.config.ts"
      reporter: "json"
    jest:
      config: "jest.config.ts"
      reporter: "json"
    cypress:
      config: "cypress.config.ts"
      results_dir: "cypress/results"

  # Model for eval planner and remediation planner agents
  model: ""  # Empty = inherit active session model

  # Always-run suites at every gate (e.g., build verification)
  always_run:
    - name: "Build"
      command: "npm run build"
      timeout_minutes: 10
      critical: true
    - name: "Type Check"
      command: "npx tsc --noEmit"
      timeout_minutes: 5
      critical: true
```

### 8.2 Eval plan config in PROMPT.md (per-task)

Tasks can declare evaluation hints that the eval planner uses:

```markdown
## Evaluation Hints
- **E2E coverage:** `tests/e2e/auth/login.spec.ts`
- **API contract:** `tests/api/auth.test.ts`
- **Requires running:** auth-service, database
- **Eval after:** AUTH-002 (test login flow after both auth tasks complete)
```

This is optional. The eval planner can work without hints (by inferring from
file scope, dependencies, and project test structure), but hints improve
gate placement accuracy.

---

## 9. Command Surface

### `/eval-plan <areas|paths|all> [--refresh]`

Generate an evaluation plan from an orchestration plan.

```text
/eval-plan all
/eval-plan auth billing
/eval-plan all --refresh
```

**Behavior:**
1. Run `/orch-plan` internally to get task list, waves, dependencies
2. Spawn eval planner agent to analyze tasks and testing infrastructure
3. Generate `EVAL-PLAN.md` and `.pi/eval/eval-plan.json`
4. Present summary to user for review

**Output example:**
```text
📋 Evaluation Plan Generated

Tasks analyzed: 12
Eval gates: 3
  Gate 1: Core API Services (after Wave 1) — 4 suites
  Gate 2: Full Stack Integration (after Wave 3) — 3 suites
  Gate F: Final Evaluation (after all waves) — 4 suites

Success criteria: 34 items across 12 tasks

Plan saved to:
  EVAL-PLAN.md (human-readable)
  .pi/eval/eval-plan.json (machine-readable)

Review the plan, then run /orch all to execute with evaluation gates.
```

### `/eval-status`

Show evaluation progress during or after a batch.

```text
📊 Evaluation Status — Batch 20260315T140000

Gate 1: Core API Services ✅ passed (attempt 1)
  Build Verification:     ✅ 0.8s
  Type Check:             ✅ 2.1s
  API Integration Tests:  ✅ 12.4s (48/48 passed)
  Smoke Test:             ✅ 1.2s

Gate 2: Full Stack Integration ⚠️ failed → remediating (attempt 2/3)
  Build Verification:     ✅ 0.9s
  E2E: Auth Flows:        ❌ 45.2s (10/12 passed, 2 failed)
  Remediation: REM-001 (in progress), REM-002 (queued)

Gate F: Final Evaluation — pending (waiting for Wave 4)
```

### Integration with existing commands

| Command | Change |
|---------|--------|
| `/orch` | If `evaluation.enabled` and eval plan exists, run gates after wave merges. If `auto_plan` and no plan exists, generate one before starting. |
| `/orch-plan` | Show eval gate summary at the bottom of the plan output (if eval plan exists). |
| `/orch-status` | Include eval gate status in progress display. |
| `/orch-pause` | Pause also halts any in-progress eval gate or remediation wave. |
| `/orch-resume` | Resume includes eval gate state reconciliation. |
| `/orch-abort` | Abort also kills eval agent sessions. |

---

## 10. Evaluation Types Reference

The eval planner selects from these evaluation types based on project
infrastructure and task characteristics:

| Type | Tools | When to use | Output format |
|------|-------|------------|---------------|
| **Build verification** | `npm run build`, `go build`, `cargo build` | Every gate — if it doesn't build, nothing else matters | Exit code |
| **Type checking** | `tsc --noEmit`, `mypy`, `cargo check` | Every gate for typed languages | Exit code + errors |
| **Unit/integration tests** | Vitest, Jest, pytest, go test | Gate covering tasks that include testable logic | JUnit XML / JSON |
| **API contract tests** | Supertest, Pact, REST-assured | Gate after API-producing tasks merge | JSON reporter |
| **E2E browser tests** | Playwright, Cypress | Gate after both backend + frontend tasks merge | HTML report + screenshots |
| **Smoke tests** | curl, custom scripts | Every gate — verify app starts and responds | Exit code |
| **Visual regression** | Playwright screenshots, Percy, Chromatic | Gate after UI-changing tasks | Screenshot diffs |
| **Accessibility** | axe-core, Playwright a11y | Gate after UI-changing tasks | JSON violations report |
| **Lint/static analysis** | ESLint, Prettier, golangci-lint | Final gate or every gate | Exit code + violations |
| **Security scanning** | npm audit, Snyk, SAST tools | Final gate | JSON vulnerabilities |
| **Database migration** | Migration up/down, seed scripts | Gate after schema-changing tasks | Exit code |
| **Performance** | k6, Artillery, Lighthouse | Final gate (optional) | JSON metrics |
| **AI-assisted exploratory** | Eval agent with browser tools | Complex flows needing judgment | Structured report |

### Selection heuristics for the eval planner

```text
IF task modifies backend API endpoints
  → API contract tests + smoke tests at next gate

IF task modifies frontend components
  → E2E tests + visual regression at gate after frontend wave

IF task modifies database schema
  → Migration tests at immediate next gate

IF task modifies auth/security
  → Security-focused E2E + API tests

IF any tasks in batch modify shared types/interfaces
  → Type checking at every gate

ALWAYS at every gate:
  → Build verification
  → Type check (if typed language)

ALWAYS at final gate:
  → Full E2E suite
  → Full unit/integration suite
  → Build + lint
```

---

## 11. Eval Agent System Prompt (`.pi/agents/task-evaluator.md`)

The eval agent needs a focused system prompt:

```markdown
# Task Evaluator Agent

You are an evaluation agent for Taskplane. Your job is to execute evaluation
suites and produce structured reports on whether integrated code meets its
success criteria.

## Your workflow

1. Read the eval gate specification (which suites to run, success criteria)
2. Set up the test environment if needed
3. Execute each suite:
   - Run the command
   - Capture output (stdout, stderr, exit code)
   - Parse structured results (JUnit XML, JSON reporters)
   - Take screenshots on E2E failures
4. Produce a structured eval result JSON
5. If all critical suites pass: report SUCCESS
6. If any critical suite fails: report FAILURE with detailed diagnostics

## Rules

- Run suites in order; stop on critical failure if configured
- Capture all output for diagnosis
- Do NOT fix code — only evaluate and report
- Do NOT modify test files — only run them
- Include actionable diagnostic information in failure reports
- Reference specific test names, error messages, and file locations
```

---

## 12. Remediation Planner Agent (`.pi/agents/eval-remediator.md`)

```markdown
# Evaluation Remediator Agent

You are a remediation planner for Taskplane. When an evaluation gate fails,
you diagnose the root cause and generate targeted remediation tasks.

## Your workflow

1. Read the eval failure report (which tests failed, error details)
2. Read the original PROMPT.md files for the tasks covered by the gate
3. Read the code changes (git log/diff on integration branch since batch start)
4. Diagnose root cause(s):
   - Implementation bug in a specific task's deliverable?
   - Integration issue between two tasks' outputs?
   - Missing implementation (task didn't fully deliver)?
   - Test environment / configuration issue?
   - Merge artifact (conflict resolution broke something)?
5. Generate minimal remediation task(s):
   - One PROMPT.md per distinct root cause
   - Reference the eval failure and original task
   - Scope narrowly (prefer S size)
   - Include the specific error output and expected behavior
6. Place tasks in the remediation staging area

## Rules

- Generate the fewest tasks possible to fix the failures
- Each task should address one root cause
- Never generate tasks to rewrite tests (unless the test itself is wrong)
- Include specific file paths and error context in each task
- Use review level 2 for remediation tasks (plan + code review)
```

---

## 13. Data Flow & Persistence

### File layout

```text
.pi/
├── eval/
│   ├── eval-plan.json                    # Machine-readable gate definitions
│   ├── eval-results/
│   │   ├── gate-1-attempt-1.json         # Per-gate, per-attempt results
│   │   ├── gate-1-attempt-1-output/      # Raw command output, screenshots
│   │   ├── gate-2-attempt-1.json
│   │   ├── gate-2-attempt-2.json         # Second attempt after remediation
│   │   └── gate-final-attempt-1.json
│   ├── remediation/
│   │   ├── gate-2-rem-1/                 # Remediation tasks for gate 2
│   │   │   ├── REM-001-fix-login-redirect/
│   │   │   │   ├── PROMPT.md
│   │   │   │   └── STATUS.md
│   │   │   └── REM-002-add-error-element/
│   │   │       ├── PROMPT.md
│   │   │       └── STATUS.md
│   │   └── ...
│   └── eval-history.json                 # Accumulated eval results across batch
EVAL-PLAN.md                              # Human-readable plan (repo root)
```

### Integration with batch state

`batch-state.json` gains new fields:

```json
{
  "evalEnabled": true,
  "evalPlanHash": "sha256:abc123...",
  "evalGateResults": [
    {
      "gateId": "gate-1",
      "status": "passed",
      "attempts": 1,
      "completedAt": 1742054400000
    },
    {
      "gateId": "gate-2",
      "status": "remediating",
      "attempts": 2,
      "remediationWaves": ["wave-2.1", "wave-2.2"],
      "completedAt": null
    }
  ],
  "totalRemediationWaves": 2,
  "totalRemediationTasks": 3
}
```

### Integration with batch history

`BatchHistorySummary` gains eval summary:

```json
{
  "evaluation": {
    "enabled": true,
    "gatesPassed": 2,
    "gatesFailed": 1,
    "totalAttempts": 4,
    "remediationTasksGenerated": 3,
    "remediationTasksSucceeded": 3
  }
}
```

---

## 14. Dashboard Integration

The orchestrator dashboard gains an evaluation panel:

```text
┌─────────────────────────────────────────────────────┐
│  📊 Batch 20260315T140000 — executing               │
│  Wave: 3/4  │  Tasks: 8/12 ✅  1 ❌  3 ⏳          │
├─────────────────────────────────────────────────────┤
│  🧪 Evaluation Gates                                │
│                                                     │
│  Gate 1: Core API Services      ✅ passed  (1/1)   │
│  Gate 2: Full Stack Integration ⚠️ attempt 2/3     │
│    └─ Remediating: REM-001 ✅  REM-002 🔄          │
│  Gate F: Final Evaluation       ⏳ pending          │
├─────────────────────────────────────────────────────┤
│  🔧 Lanes                                           │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

---

## 15. Interaction Example (End-to-End)

```text
User: /eval-plan all

Agent: Running /orch-plan internally...
       Discovered 12 tasks across 4 waves.
       Analyzing success criteria and test infrastructure...

       Detected:
       - playwright.config.ts (E2E framework)
       - vitest.config.ts (unit/integration)
       - tests/api/ (API tests)
       - tests/e2e/ (E2E tests)

       📋 Evaluation Plan Generated
       Gates: 3
         Gate 1: Core API Services (after Wave 1) — 4 suites
         Gate 2: Full Stack Integration (after Wave 3) — 3 suites
         Gate F: Final Evaluation (after all waves) — 4 suites

       Review EVAL-PLAN.md and adjust if needed.
       When ready: /orch all

User: [reviews EVAL-PLAN.md, looks good]
User: /orch all

Agent: 📋 Eval plan detected — evaluation gates will run after waves 1, 3, and final.

       🚀 Starting batch 20260315T140000 (12 tasks, 4 waves)

       ═══ Wave 1: 4 tasks (3 lanes) ═══
       ... [normal wave execution] ...
       ✅ Wave 1 complete. Merging...
       ✅ Merge complete.

       🧪 Eval Gate 1: Core API Services
         ✅ Build Verification (0.8s)
         ✅ Type Check (2.1s)
         ✅ API Integration Tests (12.4s — 48/48 passed)
         ✅ Smoke Test (1.2s)
       ✅ Gate 1 PASSED — continuing to Wave 2

       ═══ Wave 2: 3 tasks (3 lanes) ═══
       ... [normal wave execution] ...
       ✅ Wave 2 complete. Merging...

       ═══ Wave 3: 3 tasks (2 lanes) ═══
       ... [normal wave execution] ...
       ✅ Wave 3 complete. Merging...

       🧪 Eval Gate 2: Full Stack Integration
         ✅ Build Verification (0.9s)
         ❌ E2E: Auth Flows (45.2s — 10/12 passed, 2 failed)
            • login flow > should redirect to dashboard: Expected '/dashboard', got '/login'
            • login flow > should show error message: Element '.error-message' not found
       ❌ Gate 2 FAILED — entering remediation cycle (attempt 1/3)

       🔍 Diagnosing failures...
       Root causes identified:
         1. Login redirect handler missing dashboard route push
         2. Error message element uses class '.login-error' not '.error-message'

       📝 Generated remediation tasks:
         REM-001: Fix login redirect to dashboard (S)
         REM-002: Fix error message element selector (S)

       ═══ Remediation Wave 3.1: 2 tasks (2 lanes) ═══
       ... [remediation execution] ...
       ✅ Remediation wave complete. Merging...

       🧪 Re-evaluating Gate 2: Full Stack Integration (attempt 2/3)
         ✅ Build Verification (0.8s)
         ✅ E2E: Auth Flows (44.8s — 12/12 passed)
       ✅ Gate 2 PASSED — continuing to Wave 4

       ═══ Wave 4: 2 tasks (2 lanes) ═══
       ... [normal wave execution] ...
       ✅ Wave 4 complete. Merging...

       🧪 Final Eval Gate: Comprehensive Regression
         ✅ Full E2E Suite (120.3s — 87/87 passed)
         ✅ Full Test Suite (34.2s — 312/312 passed)
         ✅ Build + Lint (4.1s)
         ✅ Accessibility Audit (22.4s — 0 violations)
       ✅ Final gate PASSED

       ✅ Batch 20260315T140000 COMPLETE
       Tasks: 12 original + 2 remediation = 14 total (14 succeeded)
       Eval: 3 gates passed (1 required remediation, 1 retry)
       Duration: 38m 12s
```

---

## 16. Implementation Phases

### Phase 1: Foundation (eval plan + direct command execution)

- [ ] `eval-types.ts` — types, interfaces, constants
- [ ] `eval-plan.ts` — plan generation, parsing, persistence
- [ ] `eval-execution.ts` — direct command suite execution (no AI agent yet)
- [ ] Configuration schema additions to `task-orchestrator.yaml`
- [ ] `/eval-plan` command registration
- [ ] `/eval-status` command registration
- [ ] Integration hook in `executeOrchBatch()` for post-wave eval gates
- [ ] Gate result persistence (`.pi/eval/`)
- [ ] Tests for plan parsing, gate execution, result persistence

### Phase 2: Remediation loop

- [ ] `eval-remediation.ts` — failure diagnosis, task generation
- [ ] `.pi/agents/eval-remediator.md` — system prompt
- [ ] Remediation wave injection into orchestrator loop
- [ ] Circuit breaker logic (max retries, max tasks, max waves)
- [ ] Re-evaluation flow after remediation merge
- [ ] Tests for remediation generation, retry logic, circuit breakers

### Phase 3: AI-assisted evaluation

- [ ] `.pi/agents/task-evaluator.md` — system prompt
- [ ] Eval agent spawning for interpretive checks
- [ ] Structured result parsing from agent output
- [ ] Screenshot capture and persistence for E2E failures
- [ ] Tests for agent-based evaluation

### Phase 4: Dashboard + observability

- [ ] Dashboard eval panel component
- [ ] SSE events for eval gate progress
- [ ] Eval data in batch history summary
- [ ] Eval state in `batch-state.json` for resume
- [ ] `/orch-status` integration

### Phase 5: Auto-planning + framework detection

- [ ] Auto-detect test frameworks from project structure
- [ ] Smart gate placement heuristics
- [ ] `auto_plan: true` support in `/orch`
- [ ] `## Evaluation Hints` parsing from PROMPT.md
- [ ] Tests for framework detection and gate placement logic

---

## 17. Open Questions

1. **Eval plan ownership.** Should the eval plan be committed to git (part of
   the project) or ephemeral (generated per batch)? Committed plans enable
   version control and review but may go stale. Current proposal: generated per
   batch but optionally committable.

2. **Remediation task area.** Where do remediation tasks live? Current proposal:
   `.pi/eval/remediation/` to keep them separate from user-authored tasks. They
   should not pollute task area CONTEXT.md counters.

3. **Eval agent model selection.** Should the eval agent use the same model as
   workers, or is a cheaper/faster model sufficient? For direct command execution
   (Phase 1), no model is needed at all. For AI-assisted evaluation (Phase 3), a
   reasoning-capable model is needed for diagnostic quality.

4. **Test parallelism.** Should eval suites within a gate run in parallel? Sequential
   is simpler and allows early termination on critical failure. Parallel is faster.
   Current proposal: sequential with early termination on critical failures.

5. **Eval plan approval flow.** Should `/orch` require explicit user approval of
   the eval plan before starting? Or is generation + auto-start acceptable?
   Current proposal: `/eval-plan` is separate from `/orch`. User reviews first,
   then runs `/orch`. If `auto_plan` is true, the plan is generated and shown
   at the start of `/orch` but execution proceeds without blocking.

6. **Cross-batch regression.** Should the eval system maintain a "known good"
   test baseline across batches? This would enable detecting regressions that
   aren't covered by the current batch's eval plan. This is a future concern —
   out of scope for the initial implementation.

7. **Cost visibility.** Remediation cycles add cost (more agent invocations,
   more tokens). Should the eval system track and display remediation cost
   separately? Current proposal: yes, as part of batch history token counts.

---

## 18. Design Rationale

### Why eval gates at wave boundaries (not after individual tasks)?

- After a wave merges, the integration branch has coherent, buildable code.
  Mid-wave, lane worktrees are isolated — you can't test integration.
- Wave boundaries are the natural "integration point" in the architecture.
- The eval planner can still be selective (gate only after wave 3, not 1 or 2).

### Why a separate eval plan step (not fully automatic)?

- The eval plan is a contract: "here's what success looks like." Making it
  explicit and reviewable gives operators confidence.
- Automatic plan generation is supported (`auto_plan`) but opt-in.
- Wrong eval criteria are worse than no eval — a false-failing gate blocks
  the entire batch with remediation loops.

### Why remediation tasks instead of inline fixes?

- Remediation tasks go through the same execution model (worker/reviewer,
  STATUS.md, .DONE) — they get the same quality guarantees.
- They're auditable: you can see exactly what was fixed and why.
- They can be reviewed before execution if the operator wants.
- They integrate naturally with the existing wave/lane/merge machinery.

### Why circuit breakers?

- An eval gate that keeps failing after 3 remediation cycles is likely hitting a
  fundamental design issue that needs human judgment.
- Without circuit breakers, the system could burn unlimited compute on a
  problem it can't solve autonomously.
- The `pause` action preserves all state for human inspection and manual fix.

### Why file-backed eval results?

- Consistency with Taskplane's core philosophy.
- Eval results survive session disconnects.
- Operators can inspect results after the fact.
- Dashboard reads them for visualization.
- Resume logic can reconcile eval state after interruption.
