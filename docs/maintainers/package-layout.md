# Package Layout

This page documents the published npm package structure and what each part does.

## Published root layout

```text
taskplane/
├── bin/
│   └── taskplane.mjs
├── dashboard/
│   ├── server.cjs
│   └── public/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── extensions/
│   ├── task-orchestrator.ts
│   └── taskplane/
│       ├── index.ts
│       ├── extension.ts
│       ├── discovery.ts
│       ├── waves.ts
│       ├── execution.ts
│       ├── merge.ts
│       ├── persistence.ts
│       ├── resume.ts
│       ├── worktree.ts
│       ├── abort.ts
│       ├── formatting.ts
│       ├── sessions.ts
│       ├── messages.ts
│       ├── config.ts
│       ├── git.ts
│       └── types.ts
├── skills/
│   └── create-taskplane-task/
│       ├── SKILL.md
│       └── references/
├── templates/
│   ├── agents/
│   ├── config/
│   └── tasks/
├── package.json
├── README.md
└── LICENSE
```

---

## What pi auto-discovers

Via `package.json#pi` manifest:

- `extensions/task-orchestrator.ts`
- `skills/`

These are loaded by pi package runtime.

---

## What pi does NOT auto-discover

### CLI

- `bin/taskplane.mjs`

User runs directly as `taskplane` / `npx taskplane`.

### Dashboard

- `dashboard/server.cjs`
- `dashboard/public/*`

Launched by `taskplane dashboard`.

### Templates

- `templates/*`

Consumed by CLI scaffolding (`taskplane init`), not auto-loaded by pi.

---

## `files` whitelist and publish boundaries

Published content is controlled by `package.json#files`.

At time of writing it includes:

- `bin/`
- `dashboard/`
- `extensions/task-orchestrator.ts`
- `extensions/taskplane/`
- `skills/`
- `templates/`

Everything else (tests, local docs, internal project files) is excluded.

---

## Why this layout

- clean separation between runtime code and scaffolding assets
- direct extension entrypoints for pi loading
- zero-build dashboard runtime
- explicit publish boundary for safer npm releases

---

## Related

- [Release Process](release-process.md)
- [Package and Template Model](../explanation/package-and-template-model.md)
