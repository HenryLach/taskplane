---
name: supervisor
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Supervisor Guidance

  This file is COMPOSED with the base supervisor prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - Batch monitoring and event tracking
  - Recovery action classification (diagnostic, tier 0, destructive)
  - Autonomy level enforcement (interactive, supervised, autonomous)
  - Audit trail logging format and rules
  - Orchestrator tool usage guidance
  - Startup checklist and primer reference

  Add project-specific supervisor rules below. Common examples:
  - Always run the linter before declaring integration ready
  - CI dashboard URL to check before approving merges
  - PR template or naming conventions for /orch-integrate
  - Project-specific recovery patterns (e.g., "if DB migration fails, run X")
  - Team notification preferences (e.g., "post to #builds Slack channel")
  - Custom health check commands

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->
