# Releasing

## Version source

`package.json.version` is the single application version. The UI, MCP server and handoff manifest read it through `apps/studio/src/core/version.ts`.

Before a release:

1. Update `package.json.version`.
2. Update the release notes under `docs/release-notes/`.
3. Update every download reference and the current-release headline in `README.md`, `README.zh-CN.md` and `site/index.html`. All `studio-v<version>` links and `IPloom-Studio-<version>-…` file names must use the new version.
4. Run `bun install` if dependencies changed.
5. Run `bun run check` and the packaged preflight below.
6. Commit and merge through a pull request.
7. Create `studio-v<version>` on the merged commit.

The release workflow rejects a tag that does not exactly match `studio-v${package.version}`. `scripts/studio/verify-release-inputs.ts docs` fails when any download reference or headline version in the three documents disagrees with `package.json`, and runs both locally through `bun run check` and in CI.

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

Each `.dmg`, `.zip` and `.exe` also carries a Sigstore build-provenance attestation created by the release workflow. Verify it with the GitHub CLI:

```sh
gh attestation verify IPloom-Studio-<version>-darwin-universal.dmg --repo j4tmr/iploom
```

The attestation binds the file to the workflow run, repository and source commit. It does not replace code signing; see [Signing](#signing).

A published release, a green workflow or a reachable download URL alone does not prove the local file is intact.

## Local preflight

```sh
bun install --frozen-lockfile
bun run check
bun run studio:smoke
bun run studio:package
bun scripts/studio/verify-release-inputs.ts package --platform darwin
bun run studio:smoke:package
bun run studio:verify-mcp --packaged
bun scripts/studio/smoke.ts --packaged --arch x86_64
bun scripts/studio/verify-mcp.ts --packaged --arch x86_64
shasum -a 256 release/IPloom-Studio-* > /tmp/iploom-sha256.txt
```

`bun run check` runs `biome lint`, `biome format`, the type check, coverage tests, the release build, the shared release-input and documentation checks, and the bundled MCP verification. On Windows use `Get-FileHash -Algorithm SHA256` and `--platform win32`.

The Intel-slice commands require Rosetta 2 on Apple silicon. They launch the universal macOS bundle through `/usr/bin/arch -x86_64`, so they exercise the Intel slice and the packaged MCP runtime the same way CI does. Install Rosetta once with `softwareupdate --install-rosetta --agree-to-license`.

## GitHub Actions

Every `uses:` reference is pinned to a full commit SHA with a version comment; Dependabot updates the pins. All checkouts disable credential persistence.

`.github/workflows/studio-ci.yml` runs on pull requests and main:

- lint and format verification;
- type checking;
- domain and real stdio MCP tests on macOS and Windows;
- release-input build and shared artifact checks;
- documentation version sync;
- bundled MCP through the Electron runtime;
- macOS and Windows packaging;
- packaged application smoke;
- Intel-slice smoke and MCP verification through Rosetta;
- exact artifact-name and installer checks.

`.github/workflows/studio-release.yml` runs on `studio-v*` tags and on manual dispatch:

- `verify` fetches the full history, requires the tagged commit to be an ancestor of `origin/main`, and rejects a tag/version mismatch;
- `package` builds macOS universal DMG/ZIP and Windows NSIS, verifies the exact installer names and versions, and runs the packaged smoke, MCP verification and Intel-slice checks;
- `release` runs in the protected `release` environment, computes checksums, asserts the expected asset names, attests the `.dmg`, `.zip` and `.exe`, and creates or updates the GitHub Release.

The release job refuses to overwrite an existing published (non-draft) release unless a manual dispatch sets `overwrite_existing_release`. A draft may be replaced without the input. Overwriting a published release does not move the repository's “Latest” marker.

## Repository settings (maintainer only)

The workflows depend on repository configuration that cannot live in the repository. Apply and audit these in GitHub:

- protect `main` with required status checks and pull requests, and forbid force pushes and deletion;
- add a tag ruleset for `studio-v*` that restricts creation to maintainers;
- create the `release` environment with required reviewers and restrict deployment branches to `main`, so a release job waits for a human approval.

These settings are intentionally not modified by automation. Review them before the first signed or manually triggered release.

## Signing

The current workflow supports unsigned artifacts and labels them explicitly. It does not pretend that an unsigned build passes Gatekeeper or SmartScreen.

The packaged app keeps `RunAsNode` enabled because the bundled MCP server runs through the Electron binary. The remaining Electron fuses disable the `NODE_OPTIONS` and CLI inspect-argument escape hatches, load the application only from the ASAR archive, and remove extra file-protocol privileges. ASAR integrity validation stays off until the app is code signed.

To add signing later:

- macOS: provide a Developer ID Application certificate through GitHub secrets, enable hardened runtime and notarization, then add `codesign --verify`, `spctl --assess` and `xcrun stapler validate`.
- Windows: provide an Authenticode code-signing certificate and verify the signature with `Get-AuthenticodeSignature`.

Never commit certificates, passwords, API tokens or provisioning profiles.

## Verification after publishing

Use the GitHub API rather than the web UI for a reproducible receipt:

```sh
gh release view studio-v0.3.0 --json tagName,isDraft,isPrerelease,assets,body
gh release download studio-v0.3.0 --pattern SHA256SUMS.txt
gh attestation verify IPloom-Studio-0.3.0-darwin-universal.dmg --repo j4tmr/iploom
```

Download at least one asset per platform, recompute its SHA-256, and compare it with the release checksum file. A tag, a green build or an uploaded artifact alone does not prove the downloaded file is intact.
