# NPM Publishing Guide for Taskplane

> **Audience:** Taskplane maintainers  
> **Prerequisites:** Node.js ≥ 20, git, a terminal  
> **Related:** [CLI-SPEC.md](CLI-SPEC.md) — package structure and distribution model

---

## 1. The npm Registry

npm has a public registry at `registry.npmjs.org` — a global package store. When someone runs `npm install taskplane` or `pi install npm:taskplane`, it downloads from there. Public packages are free.

---

## 2. One-Time Setup

### 2.1 Create an npm Account

Sign up at [npmjs.com/signup](https://www.npmjs.com/signup).

### 2.2 Log In from Your Terminal

```bash
npm login
```

It'll prompt for username, password, and email (or open a browser for auth). This stores an auth token in `~/.npmrc`.

### 2.3 Check That the Package Name Is Available

```bash
npm view taskplane
```

If it returns `404` — the name is yours to claim. First publish wins.

**Reserving the name early** — if you want to claim `taskplane` before the package is ready, publish a minimal placeholder:

```bash
echo '{"name":"taskplane","version":"0.0.1","description":"AI agent orchestration for pi"}' > /tmp/taskplane-reserve/package.json
cd /tmp/taskplane-reserve
npm publish
```

---

## 3. What npm Publishes

By default, npm publishes **everything in the directory** except what's in `.gitignore` or `.npmignore`. You control this two ways:

### Option A — `files` Whitelist in `package.json` (Recommended)

```json
{
  "files": [
    "bin/",
    "dashboard/",
    "extensions/",
    "skills/",
    "themes/",
    "templates/"
  ]
}
```

Only these directories (plus `package.json`, `README.md`, `LICENSE` — always included automatically) get published. Everything else — tests, docs, `.pi/`, `.agents/`, task management folders — stays out.

### Option B — `.npmignore` (Blacklist)

```
tests/
docs/
.pi/
.agents/
taskplane-tasks/
```

**The whitelist approach (`files`) is safer** — you can't accidentally ship something you forgot to exclude.

---

## 4. Pre-Publish Verification

### Dry Run — See What Would Be Uploaded

```bash
npm pack --dry-run
```

This lists every file that would be in the tarball, with sizes. **Always run this before publishing** to make sure you're not shipping `node_modules/`, batch state files, or your entire task management history.

### Create an Inspectable Tarball

```bash
npm pack
tar -tzf taskplane-0.1.0.tgz | head -30
```

This creates a `.tgz` file you can open and inspect manually.

### Local Install Test

Test the package locally before publishing:

```bash
# Pack it
npm pack

# Install the tarball in another project
cd /path/to/test-project
pi install /path/to/taskplane-0.1.0.tgz

# Verify extensions load
pi
# Should see /task, /orch commands available
```

---

## 5. Publishing

From your package root (wherever `package.json` lives):

```bash
npm publish
```

That's it. The package is now live at `npmjs.com/package/taskplane` and installable worldwide via `pi install npm:taskplane`.

### First Publish Checklist

- [ ] `npm login` — authenticated
- [ ] `npm view taskplane` — name available (404)
- [ ] `package.json` has correct `name`, `version`, `description`, `license`
- [ ] `package.json` has `"pi"` manifest (extensions, skills, themes)
- [ ] `package.json` has `"bin"` entry for the CLI
- [ ] `package.json` has `"files"` whitelist
- [ ] `package.json` has `"pi-package"` in `keywords` (for gallery discoverability)
- [ ] `README.md` exists with install instructions
- [ ] `LICENSE` file exists
- [ ] `npm pack --dry-run` — output looks correct, no junk files
- [ ] Local install test passes — extensions load, `/task` command works

---

## 6. Versioning

npm requires [semver](https://semver.org/) versions (`MAJOR.MINOR.PATCH`).

### Bumping Versions

```bash
npm version patch   # 0.1.0 → 0.1.1  (bug fixes, doc updates)
npm version minor   # 0.1.0 → 0.2.0  (new features, backward-compatible)
npm version major   # 0.1.0 → 1.0.0  (breaking changes)
```

`npm version` automatically:
1. Updates `version` in `package.json`
2. Creates a git commit with message `v0.2.0`
3. Creates a git tag `v0.2.0`

### Pre-Release Versions

For testing before a stable release:

```bash
npm version prerelease --preid=beta   # 0.1.0 → 0.1.1-beta.0
npm publish --tag beta                # published under "beta" tag, not "latest"
```

Users install pre-releases explicitly:

```bash
pi install npm:taskplane@beta
```

The default `pi install npm:taskplane` always gets the `latest` tag.

---

## 7. Typical Release Flow

```bash
# 1. Verify everything
npm pack --dry-run              # check contents
npm test                        # run tests (if configured)

# 2. Bump version
npm version minor               # 0.1.0 → 0.2.0 (creates git commit + tag)

# 3. Publish to npm
npm publish

# 4. Push the version commit and tag to GitHub
git push && git push --tags
```

### What Users Do to Upgrade

```bash
pi update                       # pulls latest from npm
taskplane upgrade --all         # upgrades project config (agents, YAML)
```

---

## 8. How `pi install npm:taskplane` Finds the Package

The chain:

1. User runs `pi install npm:taskplane`
2. Pi runs `npm install -g taskplane` (global) or installs to `.pi/npm/` (project-local with `-l`)
3. npm downloads the package from the registry into `node_modules/taskplane/`
4. Pi reads `package.json` → the `"pi"` manifest:
   ```json
   {
     "pi": {
       "extensions": ["./extensions"],
       "skills": ["./skills"],
       "themes": ["./themes"]
     }
   }
   ```
5. Pi auto-discovers everything declared in those paths
6. Extensions register their `/commands`, skills become available, themes load
7. The `"pi-package"` keyword makes it show up in the [pi package gallery](https://shittycodingagent.ai/packages)

### Global vs. Project-Local

| Install | Command | Where it goes | Who gets it |
|---------|---------|---------------|-------------|
| Global | `pi install npm:taskplane` | `<npm-global>/node_modules/taskplane/` | Every pi session on this machine |
| Project | `pi install -l npm:taskplane` | `.pi/npm/node_modules/taskplane/` | Only this project; teammates get it via `.pi/settings.json` in git |

---

## 9. Scoped vs. Unscoped Package Names

| Style | Name | Install command | Notes |
|-------|------|-----------------|-------|
| **Unscoped** | `taskplane` | `pi install npm:taskplane` | Simpler, first-come-first-served |
| **Scoped** | `@taskplane/core` | `pi install npm:@taskplane/core` | Namespace for multiple packages |

Unscoped is what the CLI spec uses. Scoped names are useful if you later split into multiple packages (`@taskplane/core`, `@taskplane/dashboard`), but the current design ships everything in one package.

**Note:** Scoped packages require either an npm organization (free to create at npmjs.com) or publishing with `--access public` (scoped packages default to private).

---

## 10. npm Account Security

### Enable 2FA

Strongly recommended — especially for packages others will install:

```
npmjs.com → Account Settings → Two-Factor Authentication → Enable
```

### Automation Tokens

For CI/CD publishing (GitHub Actions, etc.), create an automation token:

```
npmjs.com → Account Settings → Access Tokens → Generate New Token → Automation
```

Use this token in CI secrets. It bypasses 2FA (designed for automated pipelines).

---

## 11. Unpublishing and Deprecation

### Unpublish (Within 72 Hours)

```bash
npm unpublish taskplane@0.1.0   # remove a specific version
npm unpublish taskplane --force  # remove entire package (within 72 hours only)
```

After 72 hours, npm prevents unpublishing to protect downstream users.

### Deprecate (Anytime)

```bash
npm deprecate taskplane@"< 0.2.0" "Upgrade to 0.2.0 — critical bug fix"
```

This shows a warning when anyone installs the deprecated version but doesn't remove it.

---

## 12. Useful npm Commands Reference

| Command | What it does |
|---------|-------------|
| `npm login` | Authenticate with the registry |
| `npm whoami` | Show current logged-in user |
| `npm view taskplane` | Show published package info (or 404 if not published) |
| `npm view taskplane versions` | List all published versions |
| `npm pack --dry-run` | Preview what would be published |
| `npm pack` | Create a `.tgz` tarball for inspection |
| `npm publish` | Publish to the registry |
| `npm publish --tag beta` | Publish under a non-latest tag |
| `npm version patch\|minor\|major` | Bump version, commit, and tag |
| `npm unpublish taskplane@0.1.0` | Remove a specific version (≤72 hours) |
| `npm deprecate taskplane@"<0.2.0" "msg"` | Warn users about old versions |
| `npm owner ls taskplane` | List package owners |
| `npm owner add <user> taskplane` | Add a co-maintainer |
| `npm audit` | Check dependencies for vulnerabilities |
