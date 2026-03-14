# Use the Dashboard

Taskplane includes a web dashboard for monitoring orchestration in real time.

## What it shows

- batch phase and summary counters
- wave/lane progress
- task-level status and checkbox progress (from `STATUS.md`)
- lane sidecar state (`.pi/lane-state-*.json`)
- batch history (`.pi/batch-history.json`)

---

## Start the dashboard

From your project root:

```bash
taskplane dashboard
```

Defaults:

- port: `8099`
- root: current directory
- browser auto-opens unless disabled

Options:

```bash
taskplane dashboard --port 3000
taskplane dashboard --no-open
```

---

## Typical workflow

Terminal A:

```bash
taskplane dashboard
```

Terminal B:

```bash
pi
```

Inside pi:

```text
/orch all
```

Dashboard updates live while orchestration runs.

---

## Data sources

Dashboard server reads:

- `.pi/batch-state.json`
- `.pi/lane-state-*.json`
- task `STATUS.md` files
- `.pi/batch-history.json`

Updates are pushed to browser clients via Server-Sent Events (SSE).

---

## When to use dashboard vs terminal

Use dashboard when you want:

- cross-lane overview
- visual progress tracking
- quick health checks during long runs

Use terminal output when you want:

- command interactions (`/orch-*`, `/task-*`)
- focused debugging of one lane/session

They complement each other.

---

## Troubleshooting

### Dashboard doesn’t open

Open manually in browser:

- `http://localhost:8099` (or chosen port)

### No live updates

Check that `.pi/` state files are changing during batch execution.

### Port already in use

Run with another port:

```bash
taskplane dashboard --port 3010
```

---

## Next step

- [Use TMUX for Visibility](../how-to/use-tmux-for-visibility.md)
