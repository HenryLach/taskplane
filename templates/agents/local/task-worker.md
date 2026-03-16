---
name: task-worker
# tools: read,write,edit,bash,grep,find,ls
# model: anthropic/claude-sonnet-4-20250514
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Worker Guidance

  This file is COMPOSED with the base task-worker prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - STATUS.md-first workflow and checkpoint discipline
  - Fresh-context loop behavior and iteration rules
  - Git commit conventions and .DONE file creation
  - Review response handling

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
