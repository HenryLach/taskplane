# Use TMUX for Visibility

TMUX mode gives you attachable lane sessions for deeper runtime inspection.

## When to use tmux mode

Use tmux mode when you need:

- to attach to lane sessions live
- to inspect worker/reviewer output interactively
- richer manual debugging during orchestration

Use `subprocess` mode when you want simpler, headless execution.

---

## Enable tmux mode for orchestrator

Edit `.pi/task-orchestrator.yaml`:

```yaml
orchestrator:
  spawn_mode: "tmux"
  tmux_prefix: "orch"
```

Then run:

```text
/orch all
```

---

## Session naming

Sessions are prefixed by `tmux_prefix`, commonly producing names like:

- `orch-lane-1`
- `orch-lane-2`
- `orch-lane-1-worker`
- `orch-lane-1-reviewer`

List active sessions:

```text
/orch-sessions
```

Or from shell:

```bash
tmux list-sessions
```

---

## Attach to a session

```bash
tmux attach -t orch-lane-1
```

Detach without killing session:

- `Ctrl-b`, then `d`

---

## Task-runner tmux mode

Task-runner also supports tmux spawn behavior in orchestrated environments.
In practice, orchestrator controls this via environment setup per lane.

For standalone `/task`, prefer default subprocess mode unless you specifically need tmux interaction.

---

## Common pitfalls

### `tmux: command not found`

Install tmux and verify:

```bash
tmux -V
```

### Session prefix mismatch

If `/orch-sessions` shows none, verify `tmux_prefix` in config matches expected names.

### Old sessions lingering

Abort and clean up:

```text
/orch-abort
```

If needed manually:

```bash
tmux kill-session -t <session-name>
```

---

## Related

- [Pause, Resume, or Abort a Batch](pause-resume-abort-a-batch.md)
- [Recover After Interruption](recover-after-interruption.md)
