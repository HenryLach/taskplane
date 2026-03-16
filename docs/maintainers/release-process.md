# Release Process

This guide covers how to publish a new Taskplane npm release.

## GitHub Releases vs npm Publish

These are related, but not the same operation:

- **`npm publish`** uploads installable package artifacts to npm (`npm install taskplane`).
- **GitHub Release** is a repository release record tied to a git tag (`vX.Y.Z`) with notes/assets.

Best practice for Taskplane is to keep them aligned:

- one package version in `package.json`
- one git tag (`vX.Y.Z`)
- one npm publish (`taskplane@X.Y.Z`)
- one GitHub Release (`vX.Y.Z`)

## Prerequisites

- npm publish access for `taskplane`
- clean git working tree
- Node.js 22+

---

## 1) Validate package contents

From repo root:

```bash
npm pack --dry-run
```

Confirm only intended files ship (per `package.json#files`).

Optional tarball inspection:

```bash
npm pack
tar -tzf taskplane-<version>.tgz
```

---

## 2) Run tests / smoke checks

```bash
cd extensions
npx vitest run
cd ..
```

Optional local smoke:

- `node bin/taskplane.mjs help`
- `node bin/taskplane.mjs doctor`

---

## 3) Update changelog

Update `CHANGELOG.md` with release notes.

Use Keep a Changelog style sections:

- Added
- Changed
- Fixed
- Removed

---

## 4) Bump version

```bash
npm version patch   # or minor / major
```

This updates `package.json`, creates a git commit, and creates a git tag.

---

## 5) Publish

```bash
npm publish
```

For pre-release channel:

```bash
npm publish --tag beta
```

---

## 6) Push commit and tags

```bash
git push
git push --tags
```

---

## 7) Create GitHub Release

After tags are pushed, create a GitHub Release for the same tag/version.

Example:

```bash
gh release create v<version> \
  --title "v<version>" \
  --notes-file CHANGELOG.md
```

Or create it in the GitHub UI and paste release notes from `CHANGELOG.md`.

---

## 8) Post-release verification

Verify published metadata:

```bash
npm view taskplane version
npm view taskplane versions --json
```

Verify GitHub release/tag:

```bash
gh release view v<version>
git tag --list | grep "^v<version>$"
```

Sanity install in scratch project:

```bash
pi install -l npm:taskplane
npx taskplane version
```

---

## Recommended release checklist

- [ ] Tests pass
- [ ] Changelog updated
- [ ] Version bumped
- [ ] `npm pack --dry-run` reviewed
- [ ] Published successfully
- [ ] Tag pushed
- [ ] GitHub release created for the same tag/version
- [ ] Install smoke test passed

---

## Notes

- Taskplane currently ships as a single package.
- `package.json#files` controls published file whitelist.
- Keep templates generic and public-safe before publishing.
