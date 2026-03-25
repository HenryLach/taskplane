---
name: task-worker
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Worker Guidance

  This file is COMPOSED with the base task-worker prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - STATUS.md-first workflow and checkpoint discipline
  - Multi-step execution (worker handles all remaining steps per invocation)
  - Iteration recovery (context limit → next invocation resumes from STATUS.md)
  - Git commit conventions (per-step commits) and .DONE file creation
  - Review protocol (inline reviews via review_step tool when available)
  - Review response handling
  - Test execution strategy (targeted tests during steps, full suite at gate)
  - File reading strategy (grep-first for large files, context budget awareness)

  Add project-specific rules below. Common examples:
  - Preferred package manager (pnpm, yarn, bun)
  - Test commands (make test, npm run test:unit)
  - Coding standards (linting, formatting)
  - Framework-specific patterns
  - Environment or deployment constraints

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->
