## Plan Review: Step 2 — rpc-wrapper mailbox check and steer injection

### Verdict: APPROVE

### Summary
The Step 2 plan now addresses the key correctness and safety requirements for mailbox-driven steering in `rpc-wrapper`:

- path-derived `expectedBatchId` + `expectedSessionName`
- explicit `to` validation (misdelivery protection)
- deterministic delivery ordering (timestamp + filename tie-break)
- startup steering mode enablement (`set_steering_mode: "all"`)
- robust no-crash behavior (ENOENT/no mailbox dir/malformed files)
- explicit deferral of broadcast consumption to TP-092 (aligned with task scope)

This is sufficient to proceed to implementation.

### Notes (non-blocking)

- In implementation, avoid importing TS modules directly into `bin/rpc-wrapper.mjs` at runtime (unless the wrapper execution path is explicitly updated to support TS stripping). Keep runtime dependencies `.mjs`/Node-native.
- Keep mailbox warnings concise and non-fatal so normal RPC flow remains stable under malformed/foreign files.
