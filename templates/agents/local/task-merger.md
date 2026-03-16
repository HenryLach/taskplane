---
name: task-merger
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Merger Guidance

  This file is COMPOSED with the base task-merger prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - Branch merge workflow (fast-forward, 3-way, conflict resolution)
  - Post-merge verification command execution
  - Result file JSON format and writing conventions

  Add project-specific merge rules below. Common examples:
  - Post-merge verification commands (build, lint, test)
  - Conflict resolution preferences
  - Protected files that should never be auto-merged

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->
