---
id: TP-114
name: Single Task Test
type: feature
size: S
priority: P1
---

# TP-114: Single Task Test

## Objective
Verify Runtime V2 single-task execution, telemetry capture, and dashboard observability.

## Steps

### Step 0: Preflight
- [ ] Confirm this PROMPT.md and STATUS.md exist

### Step 1: Create Test Files
- [ ] Create `hello.txt` in this task folder with content "Runtime V2 works!"
- [ ] Create `fibonacci.txt` with the first 20 Fibonacci numbers, one per line
- [ ] Create `summary.txt` with a 3-paragraph summary of what Runtime V2 is (based on reading docs/specifications/framework/taskplane-runtime-v2/01-architecture.md)

### Step 2: Code Analysis
- [ ] Read `extensions/taskplane/lane-runner.ts` and count the number of exported functions. Write the count and function names to `analysis.txt` in this task folder
- [ ] Read `extensions/taskplane/agent-host.ts` and list all event types emitted by `emitEvent()`. Write them to `events.txt` in this task folder

### Step 3: Documentation & Delivery
- [ ] Log completion in STATUS.md with a summary of all files created
