# Releasing

## Version source

`package.json.version` is the single application version. The UI, MCP server and handoff manifest read it through `apps/studio/src/core/version.ts`.

Before a release:

1. Update `package.json.version`.
2. Update the release notes under `docs/release-notes/`.
3. Run `bun install` if dependencies changed.
4. Run the complete checks.
5. Commit and merge through a pull request.
6. Create `studio-v<version>` on the merged commit.

The release workflow rejects a tag that does not exactly match `studio-v${package.version}`.

## Version semantics

Versions are strict `MAJOR.MINOR.PATCH` numbers. The in-app update check compares them numerically, so `0.10.0` is newer than `0.9.9`.

- **MAJOR** — a workspace schema, MCP contract or workflow change that requires users to migrate data or rewrite integrations.
- **MINOR** — a backwards-compatible, user-facing capability, including additive schema fields, automatic migrations and new MCP tools.
- **PATCH** — backwards-compatible fixes, documentation, CI and copy changes.

Tags not matching `studio-v<MAJOR>.<MINOR>.<PATCH>` are ignored by the update check. Publish a release as a prerelease when it should not be offered to users; drafts and prereleases are never offered.

## In-app update check

**Settings → Application update → Check for updates** asks the desktop process to read the GitHub Releases API. The check runs only when the user clicks it:

- no check runs at startup and no background timer exists;
- the request is bounded to 10 seconds and returns a structured result (`update-available`, `up-to-date`, `unavailable`);
- only stable releases whose tag matches the strict pattern are considered;
- the download link is chosen for the current platform (`.dmg` then `.zip` on macOS, `.exe` on Windows) and is opened in the system browser only after another explicit click;
- IPloom never downloads, installs or executes a release artifact itself.

The renderer only receives release metadata and HTTPS links restricted to `github.com/j4tmr/iploom/releases/`. It never receives credentials.

## Verifying a downloaded release

Users should verify each download against `SHA256SUMS.txt` from the same release before installing:

```sh
shasum -a 256 IPloom-Studio-<version>-darwin-universal.dmg
```

A published release, a green workflow or a reachable download URL alone does not prove the local file is intact.

## Local preflight

```sh
bun install --frozen-lockfile
bun run check
bun run studio:smoke
bun run studio:package
bun run studio:smoke:package
shasum -a 256 release/IPloom-Studio-* > /tmp/iploom-sha256.txt
```

On Windows use `Get-FileHash -Algorithm SHA256`.

## GitHub Actions

`.github/workflows/studio-ci.yml` runs on pull requests and main:

- type checking;
- domain and real stdio MCP tests;
- release-input build;
- bundled MCP through the Electron runtime;
- macOS and Windows packaging;
- packaged application smoke;
- artifact presence checks.

`.github/workflows/studio-release.yml` runs on `studio-v*` tags:

- validates tag/version identity;
- repeats the checks;
- builds macOS universal DMG/ZIP and Windows NSIS;
- starts each packaged executable in smoke mode;
- uploads checksums;
- creates the public GitHub Release.

## Signing

The current workflow supports unsigned artifacts and labels them explicitly. It does not pretend that an unsigned build passes Gatekeeper or SmartScreen.

To add signing later:

- macOS: provide a Developer ID Application certificate through GitHub secrets, enable hardened runtime and notarization, then add `codesign --verify`, `spctl --assess` and `xcrun stapler validate`.
- Windows: provide an Authenticode code-signing certificate and verify the signature with `Get-AuthenticodeSignature`.

Never commit certificates, passwords, API tokens or provisioning profiles.

## Verification after publishing

Use the GitHub API rather than the web UI for a reproducible receipt:

```sh
gh release view studio-v0.3.0 --json tagName,isDraft,isPrerelease,assets,body
gh release download studio-v0.3.0 --pattern SHA256SUMS.txt
```

Download at least one asset per platform, recompute its SHA-256, and compare it with the release checksum file. A tag, a green build or an uploaded artifact alone does not prove the downloaded file is intact.
