# Install Taskplane from Source

Use this path when developing Taskplane itself or testing local changes before publish.

## Prerequisites

- Node.js 22+
- Git
- pi

---

## 1) Clone repository

```bash
git clone https://github.com/HenryLach/taskplane.git
cd taskplane
```

---

## 2) Install extension dev dependencies

```bash
cd extensions
npm install
cd ..
```

---

## 3) Initialize a target project (optional)

If you want to test task execution in another repo:

```bash
cd /path/to/your-project
node /path/to/taskplane/bin/taskplane.mjs init --preset full
```

You can also run `taskplane init` if the CLI is globally installed.

---

## 4) Load local extensions in pi

From the Taskplane repo root:

```bash
pi -e extensions/task-orchestrator.ts
```

---

## 5) Verify commands

Inside pi, run:

```text
/task
/orch
/orch-plan all
```

You should get usage/help output (or planning output if task areas exist).

---

## 6) Optional: verify local CLI

From repo root:

```bash
node bin/taskplane.mjs help
node bin/taskplane.mjs version
node bin/taskplane.mjs doctor
```

---

## Notes

- Source install via `-e` does not require publishing to npm.
- For package-level behavior tests, use `npm pack` + install tarball in a scratch repo.

---

## Next step

- [Run Your First Orchestration](run-your-first-orchestration.md)
- [Run Your First Task (Single-Task Mode)](run-your-first-task.md)
