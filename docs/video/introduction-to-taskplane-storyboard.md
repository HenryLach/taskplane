# Introduction to Taskplane — YouTube Storyboard

**Target runtime:** 20–25 minutes
**Audience:** AI-coding practitioners (Claude Code / Cursor / Aider users — already comfortable with worktrees, agent loops, context windows)
**Tone:** Personal-builder narrative, first-person, opinions front and center
**Visual style:** Dark IDE-aesthetic HTML/CSS panels, monospace, green/amber accents — live in `docs/video/visuals/`

---

## How to read this document

Each scene is a numbered section with five fields:

- **Runtime:** wall-clock target and cumulative time
- **On camera:** what the viewer sees of you (talking head, screen, both)
- **B-roll / capture:** what to record or screen-cap during this beat
- **Visual cue:** which HTML/CSS visual to cut to (see `docs/video/visuals/`)
- **Talking points:** the beats — *not* a full script. You'll improvise around them.

Pickup lines in *italics* are suggested verbatim openings/closings for that scene. Use them or replace them; they're there to mark transitions cleanly.

---

# ACT 1 — The "Why" (≈ 5:30)

## Scene 1 · Cold open · 0:00 – 0:30 (~0:30)

- **On camera:** You. Tight shot. No B-roll.
- **B-roll / capture:** —
- **Visual cue:** none — pure talking head, optional title card at 0:25
- **Talking points:**
  - Hook on the punchline first. Something like: *"I wrote a million lines of code with AI before I built this. Most of that million was wasted. This is what I built once I figured out why."*
  - Name the artifact: Taskplane. One sentence: a deterministic orchestration system for multi-agent AI coding.
  - Promise the payoff: by the end you'll know what it does, why it's different, and the specific design choices I'd defend.

## Scene 2 · Origin story · 0:30 – 3:30 (~3:00)

- **On camera:** You, opening; cut between talking head and B-roll throughout.
- **B-roll / capture:** Three vignettes:
  1. A messy vibe-coding session — paste a wall of code, agent rewriting it, files scattered. ~30s.
  2. A Ralph Wiggum loop in a single terminal — same prompt over and over, agent grinding. ~30s.
  3. A parallel Ralph orchestrator — multiple panes, agents stepping on each other (conflicts, dirty git status, the loud failure modes). ~30s.
- **Visual cue:** **V1 — Origin timeline** (`visuals/01-origin-timeline.html`) — cut to it at the 1:00 mark and let it stay on screen while you narrate the three stages.
- **Talking points:**
  - *"I didn't set out to build an orchestration system. I set out to write code faster. Taskplane is the residue of about a million lines of getting that wrong."*
  - **Stage 1 — Vibe coding.** Fast feedback, low ceiling. You can ship a prototype in an afternoon and a brownfield codebase in a coma in a week.
  - **Stage 2 — The Ralph Wiggum loop.** One prompt, run it forever, let the agent grind. Massive unlock for green-field. Falls over the moment the work needs continuity across context windows or your codebase is bigger than the model's working memory.
  - **Stage 3 — Parallel Ralph.** Just run more loops. Sounds obvious. The collisions, dirty worktrees, and silent overwrites taught me the lessons that became Taskplane's invariants.
  - **The thread:** every stage failed in a way that produced a design rule. Worktrees came from collisions. STATUS.md came from context loss. Cross-model reviews came from worker-confidence problems. The merge agent came from "git can't merge intent."
  - Land the transition: *"I'll show you each of those design rules. But first — what is Taskplane actually trying to solve?"*

## Scene 3 · The problem statement · 3:30 – 4:45 (~1:15)

- **On camera:** Talking head, slow cut to visual.
- **B-roll / capture:** —
- **Visual cue:** **V2 — Light factory vs dark factory** (`visuals/02-light-factory-vs-dark.html`). Show it ≈4:00 and hold.
- **Talking points:**
  - The honest problem: agents at scale don't fail because the model is dumb. They fail because the **harness** around them is non-deterministic.
  - Three failure modes I kept hitting:
    1. **Context loss** mid-task — work disappears, agent restarts, half-done state on disk.
    2. **Silent collisions** — two agents both "completed" their work, one overwrote the other.
    3. **No operator visibility** — by the time you noticed, $8 was on fire and nobody could tell you what went wrong.
  - Taskplane's claim: you can keep the autonomy *and* get back the determinism. You don't have to choose.
  - Light factory vs dark factory framing: dark factory hides the work; light factory shows you everything happening on the floor. This is the philosophical anchor for the rest of the video.

## Scene 4 · What makes Taskplane different · 4:45 – 5:30 (~0:45)

- **On camera:** Talking head with V2 still on screen, then a brief cut to V3 preview.
- **B-roll / capture:** —
- **Visual cue:** linger on **V2**, then teaser-cut to **V3 — Agent quartet** (`visuals/03-agent-quartet.html`) at 5:15.
- **Talking points:**
  - Three differentiators in one breath:
    1. **Deterministic orchestration** with file-backed state (resumable, inspectable, recoverable).
    2. **Verbose-by-design task packets** (PROMPT.md / STATUS.md) — I'd rather you read what the agent is going to do than trust a black box.
    3. **Cross-model reviews baked in** — different model writes the code than reviews it.
  - Tease the agenda: *"We're going to walk through how Taskplane thinks, how it runs, and how you watch it run. Let's start with the four agents."*

---

# ACT 2 — How Taskplane thinks (≈ 7:30)

## Scene 5 · The minimalist agent quartet · 5:30 – 7:00 (~1:30)

- **On camera:** Full visual on screen, you narrating over it.
- **B-roll / capture:** Briefly show `.pi/agents/*.md` in an editor to make it concrete — supervisor.md, task-worker.md, task-reviewer.md, task-merger.md.
- **Visual cue:** **V3 — Agent quartet** (`visuals/03-agent-quartet.html`). Hold for the full scene.
- **Talking points:**
  - Taskplane has **exactly four agent roles**. Not seven, not twelve. Adding agents adds coordination overhead; if I can't justify why an agent exists, it doesn't exist.
  - **Supervisor** — the conversational operator-in-the-loop. Monitors batch progress, reads agent replies, can steer or override. Doesn't write code.
  - **Worker** — implements the steps in PROMPT.md. One worker per lane. Owns checkpoint discipline.
  - **Reviewer** — independent quality gate. Reads plans and code, emits `APPROVE` / `REVISE` / `RETHINK`. Persistent across a task so it remembers earlier reviews.
  - **Merger** — the LLM that combines lane branches into the orch branch. Reads conflict markers, resolves semantically, runs verification.
  - The discipline: **clear separation of concerns**. Workers optimize for progress, reviewers for correctness, mergers for integration, supervisor for control. They don't bleed.
  - Closing line: *"Four roles, four prompts, four jobs. That's it."*

## Scene 6 · The create-taskplane-task skill (verbose by design) · 7:00 – 9:30 (~2:30)

- **On camera:** Talking head opening, then mostly screen capture.
- **B-roll / capture:**
  - Live demo or pre-recorded: ask the skill to create a real task. Walk through the generated PROMPT.md showing Mission / Dependencies / File Scope / Steps / Do NOT / Amendments.
  - Show the matching STATUS.md with checkboxes.
  - Show the file tree: PROMPT.md, STATUS.md, .reviews/, .DONE absent (yet).
- **Visual cue:** **V4 — Anatomy of a task packet** (`visuals/04-task-packet-anatomy.html`). Use as a structural overlay while screen-capping the real file.
- **Talking points:**
  - This is the **most opinionated piece** of Taskplane and I want to defend it explicitly.
  - Every task is a packet of two files: **PROMPT.md** (the contract) and **STATUS.md** (the memory).
  - The skill enforces a complexity rubric — blast radius, novelty, security, reversibility — which scores into a review level (0–3) and a size (S/M/L/XL). XL must split.
  - **The verbosity is the point.** I want you to read what the agent is about to do. I want:
    - explicit `## File Scope` so the orchestrator can compute lane affinity safely
    - explicit `## Dependencies` so the wave planner can build a real DAG
    - explicit `## Do NOT` guardrails so the worker has friction against shortcuts
    - explicit step granularity so a worker can resume mid-task without re-deriving intent
  - **The contrast — the "dark factory" alternative:** a single sentence prompt and a model that "just figures it out." Faster to write, impossible to debug, impossible to audit, impossible to resume.
  - The trade-off is real: it takes longer to author a packet. The payoff is that every other part of the system — wave planning, lane affinity, reviews, merges, resume — becomes deterministic. You're paying for clarity once so that ten downstream decisions become mechanical.
  - The honest cost: this style requires you to *think* about a task before you launch it. That's a feature, not a bug.

## Scene 7 · Determinism in orchestration · 9:30 – 10:30 (~1:00)

- **On camera:** Mostly visual, talking head bookends.
- **B-roll / capture:** Show `.pi/batch-state.json` in an editor. Highlight `schemaVersion`, wave plan, per-lane records. Show `.pi/supervisor/events.jsonl` scrolling.
- **Visual cue:** **V5 — Determinism vs autonomy** (`visuals/05-determinism-spectrum.html`). Cut to it at ≈ 9:45.
- **Talking points:**
  - Where Taskplane sits on the determinism / autonomy spectrum is deliberate.
  - **The non-deterministic bits** — the LLM calls themselves, the reviewer verdicts, the merge resolutions. You can't make these deterministic without giving up the model's value.
  - **Everything around them is.** Dependency resolution is a real DAG. Wave assignment is topological sort. Lane assignment is affinity-first by file scope. Branch names are templated. State is checkpointed atomically. Events are append-only JSONL.
  - The principle: *push every decision you can to a deterministic file or rule, so the only randomness left is the model's actual thinking.*
  - Concrete payoffs: resume works. Two runs of the same batch produce the same waves. Debugging is reading files, not interrogating a process.

## Scene 8 · Cross-model reviews · 10:30 – 12:00 (~1:30)

- **On camera:** Visual primary; brief screen capture of agent config.
- **B-roll / capture:** Open `.pi/agents/task-worker.md` and `.pi/agents/task-reviewer.md`. Highlight the `model:` lines — worker on one model, reviewer on a different model. Then a dashboard shot of a review row firing under an active task.
- **Visual cue:** **V6 — Cross-model review flow** (`visuals/06-cross-model-review.html`).
- **Talking points:**
  - *"If Opus is the worker, GPT is the reviewer. Different brain reading the work. Different blind spots."*
  - Why this matters: same-model review is closer to confirmation bias than review. Models that write a certain way tend to *evaluate* that way too. Putting a different family on the other side is the cheapest possible defense.
  - **Reviews are not optional** — they're a level you set per-task (0 = none for trivial; 1 = plan; 2 = plan + code; 3 = full). The skill scores you into the right level so you don't default to "0 because it's faster."
  - **Two flavors of review:**
    1. **Plan review** — fires before the worker writes any code. Catches design problems early when the cost to redirect is one prompt, not a refactor.
    2. **Code review** — fires after a step's commits. Reviewer sees only that step's diff (baseline SHA), not the cumulative noise.
  - **Persistent reviewer context** — same reviewer across all reviews for a task, so it remembers what it flagged in Step 2 when it looks at Step 4. Costly to spawn, cheap to keep alive.
  - Verdicts are file artifacts in `.reviews/`. APPROVE / REVISE / RETHINK. REVISE is addressed inline — the worker still has its full context and just goes back and fixes it.

## Scene 9 · File-based mail · 12:00 – 13:00 (~1:00)

- **On camera:** Heavy visual; tail with talking head.
- **B-roll / capture:** Show `.pi/mailbox/{batchId}/{session}/inbox`, `outbox`, `ack`, and `_broadcast`. Drop a `send_agent_message` call and show the file appear, then move to `ack`.
- **Visual cue:** **V7 — Mailbox protocol** (`visuals/07-mailbox-protocol.html`).
- **Talking points:**
  - Real problem this solves: the supervisor needs to talk to a *running* agent without killing it. Stdin injection is platform-specific and one-way. Tmux send-keys is brittle. Sockets aren't portable.
  - **The answer is a directory.** Inbox, outbox, ack, batch-scoped, session-scoped. The supervisor writes a JSON message file; the agent's RPC wrapper sees it, injects it as a user turn; the agent replies into the outbox.
  - Why files: zero dependencies, cross-platform, survives crashes, **human-debuggable**. You can `cat` a mailbox to know exactly what the supervisor told an agent.
  - Same pattern already runs the rest of the system: `.DONE`, `.review-signal-*`, `lane-state-*.json`, `merge-request-*.txt`. The mailbox just extends a proven idiom.

---

# ACT 3 — How Taskplane runs (≈ 8:30)

## Scene 10 · Worktrees and parallelization · 13:00 – 14:30 (~1:30)

- **On camera:** Heavy visual; bookend talking head.
- **B-roll / capture:** Terminal: `git worktree list` during a batch. Show `.worktrees/{batchId}/lane-1/`, `lane-2/`, `merge/`. File explorer side-by-side showing two lanes with different files.
- **Visual cue:** **V8 — Waves, lanes, worktrees** (`visuals/08-waves-lanes-worktrees.html`).
- **Talking points:**
  - The unit of isolation is a **git worktree**. Each lane gets its own working directory pinned to its own branch, sharing the same `.git` history.
  - Why worktrees and not just "more directories":
    - shared object store — cheap
    - real branches — auditable
    - clean parallelism — no agent can clobber another's files
    - failure preservation — a failed lane's worktree stays around for forensics
  - **Three concepts, three jobs:**
    - **Wave** — a dependency-safe batch. Topological sort over the task DAG. Wave 2 doesn't start until Wave 1's merge completes.
    - **Lane** — a parallel execution slot within a wave. Capped by `max_lanes`. A lane runs one worker at a time; multiple tasks on the same lane run **serially**.
    - **Worktree** — the lane's actual checkout.
  - **Affinity-first lane assignment** is the under-loved feature. Tasks that share `## File Scope` entries get collapsed onto the same lane so they execute in sequence in a shared worktree. That converts a future merge conflict into a no-op fast-forward. The verbosity in PROMPT.md is what makes this safe.

## Scene 11 · The branching / merging strategy · 14:30 – 16:30 (~2:00)

- **On camera:** Visual primary throughout; screen-cap interleaved.
- **B-roll / capture:** `git log --graph --oneline --all` during a multi-wave batch. Show the orch branch, the lane branches fanning off and merging back. Then `/orch-integrate` and the fast-forward of `main`.
- **Visual cue:** **V9 — Branching lifecycle** (`visuals/09-branching-lifecycle.html`).
- **Talking points:**
  - **Your working branch is sacred.** Taskplane never touches it during a batch.
  - The flow:
    1. `/orch` creates `orch/{operatorId}-{batchId}` from your current branch.
    2. Each lane gets `task/{op}-lane-{N}-{batchId}` off the orch branch.
    3. Workers commit to lane branches.
    4. When a wave finishes, lane branches **merge into the orch branch** (not into your working branch).
    5. Next wave starts from the post-merge orch branch state. This is critical: Wave 2 sees Wave 1's combined output, not just one lane's view.
    6. When all waves complete, `/orch-integrate` brings the orch branch back to your working branch (fast-forward, merge commit, or PR — your call).
  - **Why this matters:**
    - You can keep working in your checkout while a batch runs.
    - If a batch dies on Wave 3, your working branch is still clean. Restart, retry, or walk away.
    - Integration is an explicit, reviewable step. No surprise merges.

## Scene 12 · The LLM merge agent · 16:30 – 18:00 (~1:30)

- **On camera:** Visual + screen capture.
- **B-roll / capture:** Walk through a real conflict resolution from a prior batch (or stage one):
  1. `git merge` halts with a conflict marker
  2. The merge agent reads PROMPT.md for both lanes
  3. Resolves semantically, commits, runs verify command
  4. Result JSON written, engine picks it up
- **Visual cue:** **V10 — Semantic merge vs git merge** (`visuals/10-semantic-merge.html`).
- **Talking points:**
  - Plain `git merge` does textual 3-way. It can't tell you that Worker A adding validation and Worker B adding a parameter are **complementary** changes — it just sees overlapping regions and gives up.
  - Taskplane's merge agent is a **full LLM with read/write/edit/bash**. It:
    1. Reads conflict markers
    2. Reads both sides' PROMPT.md to understand intent
    3. Edits the file to combine the changes semantically
    4. Commits
    5. Runs your `merge.verify` command (typically the test suite)
    6. If verify fails, it can iterate on the merge before reporting failure
  - **Merge health monitor** runs in the background — every 2 minutes, checks PID liveness + activity. Stale at 10 min, stuck at 20 min. It **emits events but never kills autonomously**. The supervisor (you, or the autonomous one) decides.
  - This is the piece that makes genuine parallelism safe. Without it, you'd either serialize everything (slow) or hope file scopes don't overlap (fragile).

## Scene 13 · Polyrepo: the hard problem · 18:00 – 21:00 (~3:00)

- **On camera:** Heavy visual; periodic screen-cap.
- **B-roll / capture:**
  - Show a workspace folder with `taskplane-pointer.json` at the root and 3 sibling repos (`shared-libs/`, `api-service/`, `web-client/`).
  - Open a real multi-repo PROMPT.md showing `#### Segment: shared-libs` markers in each step.
  - Show `.pi/batch-state.json` with `segments[]` array, `packetRepoId`, `activeSegmentId`.
- **Visual cue:** **V11 — Polyrepo segments + packet home** (`visuals/11-polyrepo-segments.html`).
- **Talking points:**
  - **Monorepo is the easy case.** One git history, one set of worktrees, one merge target. Taskplane runs single-repo mode and most of what we just talked about applies cleanly.
  - **Polyrepo is the hard case** because:
    1. Three independent git histories that need to advance *coherently*.
    2. A single task's code changes might span multiple repos.
    3. The task's PROMPT.md / STATUS.md / .DONE need a single source of truth — they can't be duplicated across repos.
    4. Each repo's worktree, branch, and merge has to be tracked independently.
    5. Failures need to be repo-scoped so unrelated work keeps moving.
  - **Taskplane's answers:**
    - **Workspace mode** kicks in when `taskplane-pointer.json` is present. No silent fallback to repo mode.
    - **A packet home repo** is declared in config (`routing.taskPacketRepo`). All packet files (PROMPT.md / STATUS.md / .DONE / .reviews) live there. No ambiguity.
    - **Tasks decompose into segments** — one segment per repo. A task spanning three repos has three segments.
    - **Segment markers in PROMPT.md** (`#### Segment: <repoId>`) tell the worker which repo to write to. The skill generates these explicitly — no inference.
    - **A segment DAG** controls intra-task ordering: shared-libs first, then API, then web-client. Optional explicit `## Segment DAG` block, with deterministic inference as fallback.
    - **The orch branch is created per-repo.** `/orch-integrate` loops over every repo with an orch branch.
  - The point: polyrepo isn't bolted on. The persistence schema (v4) treats segments as first-class. The lane runner uses `ExecutionUnit.packet` paths instead of inferring from cwd. Every place that touches "the repo" knows it might be one of many.

## Scene 14 · Segmentation in action · 21:00 – 22:00 (~1:00)

- **On camera:** Visual + screen capture together.
- **B-roll / capture:** Walk one real multi-repo task through:
  1. Skill generates PROMPT.md with segments for `shared-libs`, `api-service`, `web-client`
  2. Planner builds segment DAG
  3. Lane runs Segment A (shared-libs), commits in shared-libs worktree
  4. Same lane picks up Segment B (api-service), commits in api-service worktree
  5. STATUS.md updates land in the packet home repo throughout
- **Visual cue:** keep **V11** on screen; optionally overlay STATUS.md updates.
- **Talking points:**
  - One task. One STATUS.md. Multiple worktrees. Sequential segments inside the task; parallel tasks across the wave.
  - The worker keeps full task context across segments — it can *read* across all repos at any time for planning. It can only *write* into the active segment repo and the packet home repo.
  - **Dynamic segment expansion** (post-MVP) lets a worker say "I need to touch a 4th repo I didn't anticipate" — engine validates, supervisor approves, DAG mutates.
  - The headline: polyrepo work is no longer "run three sequential single-repo batches and pray." It's one coherent task with one memory.

---

# ACT 4 — The operator's view (≈ 2:30)

## Scene 15 · Why a web dashboard (not CLI) · 22:00 – 23:30 (~1:30)

- **On camera:** Screen-cap heavy. Open the dashboard during a live batch.
- **B-roll / capture:**
  - `taskplane dashboard` → `http://localhost:8099`
  - Show wave/lane progress bars, the active worker row with token count + cost, a reviewer sub-row firing under a task, merge telemetry, batch history.
  - Brief cut to a `tmux`-style pile of panes for contrast.
- **Visual cue:** **V12 — Dashboard visibility map** (`visuals/12-dashboard-visibility.html`).
- **Talking points:**
  - I get asked this a lot: *"Why not a CLI dashboard? You're a CLI guy."*
  - Two reasons.
    1. **The data is structured.** Lane state, reviewer state, merge state, supervisor actions, batch history. CLIs are good at one stream. Dashboards are good at many.
    2. **The audience is mid-glance.** When I'm running a batch I'm not staring at it. I check every few minutes. A browser tab updates over SSE while I work; a tmux pane needs my attention to render.
  - The dashboard is **read-only** by design. Control happens through the supervisor agent or `/orch` commands. The dashboard never lies because it never decides.
  - One file per source: `.pi/batch-state.json`, `.pi/lane-state-*.json`, `.pi/supervisor/events.jsonl`, `.reviews/`. The dashboard is a view over disk, not a process you trust.

## Scene 16 · The right balance of visibility (light factory) · 23:30 – 24:30 (~1:00)

- **On camera:** Talking head primary; brief recall of V2.
- **B-roll / capture:** —
- **Visual cue:** brief recall of **V2 — Light factory vs dark factory**, then back to talking head for the close.
- **Talking points:**
  - Bring it home: the *visibility* spectrum.
  - **Too dark:** "Tell the agent what to do, come back tomorrow." Cheap until it isn't.
  - **Too bright:** every keystroke streams to your terminal, you babysit the agent.
  - **The middle (light factory):**
    - The plan is on disk (PROMPT.md)
    - The progress is on disk (STATUS.md)
    - The decisions are on disk (`.reviews/`, mailbox, events.jsonl)
    - The control surface is asymmetric — you can step in at any boundary (steer via mailbox, pause via `/orch-pause`, retry a task, force a merge) but you don't *have* to.
  - This is the rule I'd defend hardest: **autonomy is fine, but it must be inspectable autonomy.** If you can't audit what an agent did from disk after the fact, you've built a dark factory.

## Scene 17 · Close · 24:30 – 25:00 (~0:30)

- **On camera:** Talking head, tight shot.
- **B-roll / capture:** —
- **Visual cue:** Title card / repo link / dashboard URL.
- **Talking points:**
  - One-line recap: *"Four agents. Verbose packets. Deterministic orchestration. Cross-model reviews. Worktree isolation. Semantic merges. Packet-home polyrepo. A dashboard that doesn't lie."*
  - What to do next: install, run `taskplane init`, run the first orchestration tutorial, watch the dashboard.
  - Where to find it: GitHub link, npm package, docs.
  - Sign-off — your usual outro.

---

# Extras / cutting-room

These are agenda items you didn't list but I think are worth a beat. Drop in where you have room or save for a Part 2.

1. **The persistent-context worker loop** — one worker per task, not one worker per step. Single context across all steps. Iteration only on context overflow. Massive cost reduction vs. fresh-spawn-per-step. Worth a 60-second beat in Scene 6 or as a chapter marker.
2. **Quality gate** (post-`.DONE` cross-model review with PASS / NEEDS_FIXES verdict + remediation loop). Mentionable in Scene 8 as a "third tier of review."
3. **Resilience tier** — supervisor exit interception (worker exits without progress → supervisor gets the last message + can re-steer up to 2× before failing the task). One-line in Scene 9.
4. **The skill is open-ended on STATUS.md hydration** — outcome-level checkboxes preferred over micro-checklists; the `⚠️ Hydrate` marker for discovery-dependent steps. Optional 30-second clip in Scene 6 if you want to defend the "no micro-script" stance.
5. **Doctor / init / templates** — quick CLI demo of `taskplane init` and `taskplane doctor`. Good cold-open candidate for a follow-up "getting started" video.
6. **Why pi (not Claude Code / etc. directly)** — pi gives Taskplane the multi-model abstraction it needs for cross-model reviews. Worth a 30s sidebar in Scene 8 if you want to head off the FAQ.
7. **Self-doc loop** — the `selfDocTargets` config that lets agents log discoveries into project docs over time. A nice tease for a future video.

---

# Visuals manifest

All visuals are standalone HTML files in `docs/video/visuals/`. Each is dark-IDE-styled, monospace, with green/amber accents. They're written to be:

- **Reusable** — drop into a blog post, a slide, or a website unchanged
- **Recordable** — open in a browser, OBS scene-capture the window
- **Editable** — single file each, all CSS inline, no external assets

| #   | File                                | Used in scene(s) | Purpose                                                              |
| --- | ----------------------------------- | ---------------- | -------------------------------------------------------------------- |
| V1  | `01-origin-timeline.html`           | 2                | Vibe → Ralph → Parallel Ralph → Taskplane progression                |
| V2  | `02-light-factory-vs-dark.html`     | 3, 16            | Side-by-side philosophy framing                                      |
| V3  | `03-agent-quartet.html`             | 4, 5             | Four agent roles with one-line responsibilities                      |
| V4  | `04-task-packet-anatomy.html`       | 6                | Annotated PROMPT.md + STATUS.md structure                            |
| V5  | `05-determinism-spectrum.html`      | 7                | What Taskplane forces deterministic vs leaves to the model           |
| V6  | `06-cross-model-review.html`        | 8                | Worker model → Reviewer model handoff with verdicts                  |
| V7  | `07-mailbox-protocol.html`          | 9                | Supervisor ↔ inbox/outbox ↔ agent file flow                          |
| V8  | `08-waves-lanes-worktrees.html`     | 10               | Wave → Lane → Worktree hierarchy                                     |
| V9  | `09-branching-lifecycle.html`       | 11               | Working branch → orch branch → lane branches → merge → integrate     |
| V10 | `10-semantic-merge.html`            | 12               | git merge conflict vs LLM semantic resolution                        |
| V11 | `11-polyrepo-segments.html`         | 13, 14           | Three repos, segments per repo, packet home, segment DAG             |
| V12 | `12-dashboard-visibility.html`      | 15               | What the dashboard exposes from disk                                 |

---

# Pacing summary

| Act | Window         | Length  | Cumulative |
| --- | -------------- | ------- | ---------- |
| 1   | 0:00 – 5:30    | 5:30    | 5:30       |
| 2   | 5:30 – 13:00   | 7:30    | 13:00      |
| 3   | 13:00 – 21:30  | 8:30    | 21:30      |
| 4   | 21:30 – 25:00  | 3:30    | 25:00      |

Total: 25:00. Trim Scene 14 or Scene 16 to land closer to 22 minutes if needed; both are designed to absorb cuts without breaking the throughline.

---

# Open questions for the next iteration

Things I'd like your decision on before we move from storyboard → script:

1. **Live demo or pre-recorded screen captures?** Live is more authentic, pre-recorded is cleaner. I'd suggest pre-recorded for Scenes 6, 11, 12, 13–15 and live for Scene 2's B-roll vignettes.
2. **Real client name on screen?** Some of the dashboard / status / mailbox captures will show real task IDs (TP-xxx). Are any of those sensitive, or all fair game?
3. **One million lines — should we cite the source?** A subtle on-screen badge would land the claim harder. Up to you whether to be specific or keep it as a round figure.
4. **Music?** Doesn't change the storyboard but does change the pacing of Scenes 2 and 17. If there's a bed I should write to, tell me now.
5. **Companion blog post?** This storyboard reads like a longform article with a couple of pivots. Would be cheap to spin out as a Medium piece that links back to the video.
