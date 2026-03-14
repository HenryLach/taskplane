# Release Process

This guide covers how to publish a new Taskplane npm release.

## Prerequisites

- npm publish access for `taskplane`
- clean git working tree
- Node.js 20+

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

## 7) Post-release verification

Verify published metadata:

```bash
npm view taskplane version
npm view taskplane versions --json
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
- [ ] Install smoke test passed

---

## Notes

- Taskplane currently ships as a single package.
- `package.json#files` controls published file whitelist.
- Keep templates generic and public-safe before publishing.
