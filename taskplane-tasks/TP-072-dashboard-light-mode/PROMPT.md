# Task: TP-072 - Dashboard Light Mode with Theme Toggle

**Created:** 2026-03-26
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** UI/CSS-only changes to the dashboard. No backend logic, no extension code, no security. Adds a theme toggle and light-mode color scheme.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-072-dashboard-light-mode/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Create a light-mode theme for the dashboard and add a sun/moon toggle in the header to switch between light and dark mode. Persist the user's choice at the project level so different projects can have different themes (useful for distinguishing between simultaneously open dashboards).

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `dashboard/public/style.css` — all current CSS variables and color definitions
- `dashboard/public/index.html` — header structure where toggle goes
- `dashboard/public/app.js` — any existing theme or preference logic
- `dashboard/server.cjs` — need to add an API endpoint for reading/writing theme preference

## Environment

- **Workspace:** `dashboard/`
- **Services required:** None

## File Scope

- `dashboard/public/style.css`
- `dashboard/public/index.html`
- `dashboard/public/app.js`
- `dashboard/server.cjs`

## Steps

### Step 0: Preflight

- [ ] Read `style.css` — identify all color definitions (likely CSS custom properties on `:root`)
- [ ] Read `index.html` — identify header structure for toggle placement
- [ ] Read `server.cjs` — identify how the server resolves the project root (for persisting preference)
- [ ] Verify `dashboard/public/taskplane-word-color.svg` exists (light mode logo)
- [ ] Verify `dashboard/public/taskplane-word-white.svg` exists (dark mode logo)

### Step 1: Refactor CSS for Theme Variables

The current CSS likely has colors defined directly or in `:root`. Refactor to support two themes:

**Dark mode (current, default):**
```css
[data-theme="dark"] {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --text-primary: #e6edf3;
    --text-muted: #8b949e;
    /* ... all current colors ... */
}
```

**Light mode (new):**
```css
[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f6f8fa;
    --text-primary: #1f2328;
    --text-muted: #656d76;
    /* ... light equivalents ... */
}
```

**Design guidance for light mode:**
- Use GitHub's light theme as a reference (clean, professional, high contrast)
- Backgrounds: white/light gray
- Text: dark gray/black
- Accent colors (status badges, progress bars): keep saturated but adjust for light backgrounds
- Borders: light gray instead of dark gray
- Status dots: same hue but adjusted brightness for visibility on light backgrounds
- The header can be a slightly darker bar (light gray) for contrast

**Important:** Every color in the current CSS must have a light-mode equivalent. Search for any hardcoded color values that aren't using CSS variables and convert them.

**Artifacts:**
- `dashboard/public/style.css` (modified)

### Step 2: Add Theme Toggle to Header

Add a sun/moon toggle button in the dashboard header, positioned on the far right:

**Toggle design:**
- Use Unicode or SVG icons: ☀️ (sun) for "switch to light" and 🌙 (moon) for "switch to dark"
- Small, unobtrusive button that fits the header aesthetic
- Active state indicates current theme (sun shown when in dark mode = "click for light", moon shown when in light mode = "click for dark")
- Smooth transition when switching (CSS `transition` on color properties)

**Logo switching:**
- Dark mode: `taskplane-word-white.svg`
- Light mode: `taskplane-word-color.svg`
- Toggle updates the `<img>` src attribute

**Artifacts:**
- `dashboard/public/index.html` (modified — add toggle button)
- `dashboard/public/app.js` (modified — toggle logic)

### Step 3: Persist Theme Preference at Project Level

Persist the theme choice so it survives dashboard restarts and is scoped to the project:

**Storage:** Write to `.pi/dashboard-preferences.json` in the project root:
```json
{
    "theme": "dark"
}
```

**API endpoints on the dashboard server:**
- `GET /api/preferences` — returns current preferences (or defaults)
- `POST /api/preferences` — saves preferences

**On dashboard load:**
1. Fetch `GET /api/preferences`
2. Apply saved theme (or default to dark)
3. Set `data-theme` attribute on `<html>` or `<body>`

**On toggle click:**
1. Switch theme
2. Update `data-theme` attribute
3. Update logo src
4. `POST /api/preferences` with new theme

**Project-level scoping:** The dashboard server already knows the project root (`REPO_ROOT`). The preferences file is written there, so each project gets its own theme setting.

**Artifacts:**
- `dashboard/server.cjs` (modified — add preferences endpoints)
- `dashboard/public/app.js` (modified — load/save preferences)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`
- [ ] Manual verification: toggle works, preference persists across restarts, both themes render correctly

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- None

## Completion Criteria

- [ ] Light mode theme with proper contrast and readability
- [ ] Sun/moon toggle in header switches themes
- [ ] Logo swaps between white (dark mode) and color (light mode)
- [ ] Theme preference persisted in `.pi/dashboard-preferences.json`
- [ ] Different projects can have different themes
- [ ] Smooth CSS transition on theme switch
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-072): complete Step N — description`

## Do NOT

- Change any dashboard functionality (data, SSE, API endpoints other than preferences)
- Remove dark mode or make light mode the default
- Use localStorage for persistence (must be project-level via server, not browser-level)
- Add external CSS frameworks or icon libraries — keep it vanilla

---

## Amendments
