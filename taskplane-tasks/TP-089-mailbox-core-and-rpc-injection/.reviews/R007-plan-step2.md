## Plan Review: Step 2 — rpc-wrapper mailbox check and steer injection

### Verdict: REVISE

### Summary
Good improvement from R006: the plan now covers misdelivery checks (`to`), deterministic ordering, path-derived batch/session validation intent, and explicitly defers broadcast to TP-092 (aligned with task scope).

There are still two plan-level ambiguities that can cause incorrect delivery behavior if implemented literally.

### Blocking findings

1. **[High] Path-derivation wording is internally ambiguous/inverted.**
   The current bullets say derive from `mailboxDir` using:
   - batch = **grandparent basename**
   - session = **parent basename**

   If interpreted literally against `mailboxDir = .../mailbox/{batchId}/{sessionName}`, that yields wrong values (`mailbox` / `{batchId}`).

   Please pin this down with exact formulas (one unambiguous variant), e.g.:
   - `inboxDir = join(mailboxDir, "inbox")`
   - `expectedSessionName = basename(mailboxDir)`
   - `expectedBatchId = basename(dirname(mailboxDir))`

   (Equivalent parent/grandparent formulas are fine if explicitly based on `inboxDir`, not `mailboxDir`.)

2. **[Medium] Validation list is missing `timestamp` finiteness despite timestamp-sorted delivery requirement.**
   Plan says sort by timestamp, but required fields list only `id`, `content`, `type`.
   
   Add explicit validation for:
   - `timestamp` is finite number
   - `type` is in allowed mailbox type set (not just present)

   Otherwise malformed files can produce unstable ordering or silent bad injections.

### Non-blocking suggestions

- For startup behavior, consider sending `set_steering_mode: "all"` **before** or immediately after prompt with a short comment documenting why ordering is safe.
- Specify that ENOENT on inbox read (dir not present yet) is treated as quiet no-op to avoid noisy stderr during startup races.

