# GitHub Actions Release Workflow — Design Spec

**Date:** 2026-06-02  
**Version target:** 0.1.0  
**Status:** Approved

---

## Overview

Set up a GitHub Actions workflow that automatically builds and publishes a GitHub Release whenever a version tag is pushed. The release includes a signed macOS arm64 `.dmg`, a SHA-256 checksums file, and auto-generated release notes from git history.

---

## Trigger

- **Event:** `push` to tags matching `v*.*.*`
- **Manual:** Not required; tag push is the sole trigger
- **Branch scope:** Tags may be pushed from any branch (typically `main`)

---

## Versioning

Before tagging, the developer manually updates:
- `app/package.json` → `"version": "0.1.0"`
- `app/build-meta.json` → `"version": "0.1.0"`

Then:
```bash
git add app/package.json app/build-meta.json
git commit -m "chore: bump version to 0.1.0"
git tag v0.1.0
git push origin v0.1.0
```

The workflow extracts the version from the tag name (strips leading `v`) and uses it throughout.

---

## Workflow Architecture

**File:** `.github/workflows/release.yml`  
**Two jobs:** `build-shim` → `build-electron`

---

## Job 1: `build-shim`

**Runner:** `macos-latest` (arm64)

| Step | Detail |
|------|--------|
| Checkout | `actions/checkout@v4` |
| Rust cache | `actions/cache@v4` keyed on `shim/Cargo.lock` hash; cache path `~/.cargo` + `shim/target` |
| Build | `cargo build --release` in `shim/` |
| Upload artifact | `actions/upload-artifact@v4` — uploads `shim/target/release/shim` as artifact `shim-binary` |

---

## Job 2: `build-electron`

**Runner:** `macos-latest` (arm64)  
**Depends on:** `build-shim`

| Step | Detail |
|------|--------|
| Checkout | `actions/checkout@v4` with `fetch-depth: 0` (needed for full git log) |
| Download shim | `actions/download-artifact@v4` — places `shim` binary at `shim/target/release/shim` |
| Make executable | `chmod +x shim/target/release/shim` |
| Node setup | `actions/setup-node@v4` with Node 20, npm cache |
| Install deps | `npm ci` in `app/` |
| Build DMG | `npm run build` in `app/` with env `CSC_IDENTITY_AUTO_DISCOVERY=false` |
| Ad-hoc sign | `codesign --force --deep --sign - app/dist/*.dmg` |
| Checksums | `shasum -a 256 app/dist/*.dmg > app/dist/sha256sums.txt` |
| Release notes | `git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --pretty=format:"- %s"` → saved to `release-notes.md`; falls back to full log if no prior tag exists |
| Publish release | `softprops/action-gh-release@v2` — title `v{VERSION} — VDO.MultiCh.Comms`, body from `release-notes.md`, files: `app/dist/*.dmg` + `app/dist/sha256sums.txt` |

---

## Signing

- Apple Developer ID signing is **skipped** (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- Ad-hoc signing is applied via `codesign --force --deep --sign -`
- Users installing on other Macs must right-click → Open to bypass Gatekeeper (acceptable for 0.1.0)

---

## Permissions

The workflow requires `contents: write` permission to create GitHub Releases. This is set at the job level.

---

## Secrets

No custom secrets required. The workflow uses the built-in `GITHUB_TOKEN` for release creation.

---

## Artifacts

| File | Description |
|------|-------------|
| `VDO.MultiCh.Comms-0.1.0-arm64.dmg` | macOS arm64 installer |
| `sha256sums.txt` | SHA-256 hash of the DMG |
| Release body | Bullet list of commits since previous tag |

---

## Future Considerations

- Full Apple Developer ID notarization when distributing beyond trusted testers
- Windows build job (separate runner, `nsis` target)
- macOS x64 universal binary
