# Task: TP-064 - Fix Dashboard Telemetry Crash on Large JSONL Files

**Created:** 2026-03-25
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Targeted fix in one function (`tailJsonlFile`) in the dashboard server. No new patterns, no security, easily reversible.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-064-dashboard-telemetry-crash/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

The dashboard crashes with `ERR_STRING_TOO_LONG` when telemetry JSONL files exceed ~512MB (Node.js V8 string limit). This happens during multi-wave batches with many tasks, or when the dashboard starts after a batch has been running for a while. Reported by external user in #213.

The crash is in `tailJsonlFile()` at `dashboard/server.cjs:317`:
```js
const bytesToRead = fileSize - tailState.offset;  // could be hundreds of MB
const buf = Buffer.alloc(bytesToRead);
// ...
const chunk = tailState.partial + buf.toString('utf-8');  // 💥 ERR_STRING_TOO_LONG
```

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `dashboard/server.cjs` — `tailJsonlFile()` function (~line 273), `loadTelemetryData()` (~line 345)

## Environment

- **Workspace:** `dashboard/`
- **Services required:** None

## File Scope

- `dashboard/server.cjs`

## Steps

### Step 0: Preflight

- [ ] Read `tailJsonlFile()` in `dashboard/server.cjs` (~line 273)
- [ ] Read `loadTelemetryData()` to understand how tailing is called per-file
- [ ] Understand the tail state: `{ offset, partial }` per file path

### Step 1: Fix tailJsonlFile for Large Files

Three changes to `tailJsonlFile()`:

**1. Cap read size per tick.**
Add a constant `MAX_TAIL_BYTES` (e.g., 10MB = 10 * 1024 * 1024). On each call, read at most `MAX_TAIL_BYTES` from the file. If there's more data remaining, the next SSE tick will pick up the rest. This naturally paginates through large files without ever hitting the string limit.

```js
const MAX_TAIL_BYTES = 10 * 1024 * 1024; // 10MB per tick
const bytesToRead = Math.min(fileSize - tailState.offset, MAX_TAIL_BYTES);
```

**2. Skip-to-tail on fresh dashboard start.**
When `tailState.offset` is 0 and the file is larger than `MAX_TAIL_BYTES`, skip to `fileSize - MAX_TAIL_BYTES` instead of reading from the beginning. This means the dashboard shows recent telemetry immediately instead of trying to process the entire file history. The partial-line handling already accounts for starting mid-line (it discards the first partial line).

```js
if (tailState.offset === 0 && fileSize > MAX_TAIL_BYTES) {
    tailState.offset = fileSize - MAX_TAIL_BYTES;
}
```

**3. Guard the Buffer allocation.**
As a safety net, never allocate a buffer larger than `MAX_TAIL_BYTES`:

```js
const buf = Buffer.alloc(Math.min(bytesToRead, MAX_TAIL_BYTES));
```

**Artifacts:**
- `dashboard/server.cjs` (modified)

### Step 2: Testing & Verification

> ZERO test failures allowed.

- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`
- [ ] Manual verification: confirm dashboard starts without crash (existing telemetry files)

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- None

## Completion Criteria

- [ ] `tailJsonlFile()` never reads more than MAX_TAIL_BYTES per tick
- [ ] Fresh dashboard start on large files skips to tail instead of reading from offset 0
- [ ] No `ERR_STRING_TOO_LONG` crash regardless of file size
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-064): complete Step N — description`

## Do NOT

- Change the telemetry file format or naming
- Change the SSE streaming protocol
- Add file rotation or cleanup (separate concern)
- Modify any other dashboard functionality

---

## Amendments
