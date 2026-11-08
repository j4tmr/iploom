# Contributing

Thank you for improving IPloom Studio.

## Before opening an issue

- Search existing issues.
- Use the bug or feature template.
- Include the app version, OS, architecture and exact reproduction steps.
- Remove private manuscripts, names, workspace paths, credentials and production assets.

## Pull requests

1. Open or link an issue for non-trivial work.
2. Fork the repository and create a focused branch.
3. Keep changes scoped. Do not combine unrelated refactors.
4. Add or update tests for domain, persistence, MCP and export behavior. Keep every test file isolated: inject fakes through parameters instead of `mock.module`, which Bun applies process-wide for every later test file (`bun run studio:verify-test-isolation` scans for it, and the `tests/studio/mock-module-guard.ts` preload makes any call throw at runtime).
5. Run:

```sh
bun install --frozen-lockfile
bun run check
bun run studio:smoke
```

6. Describe user-visible impact, verification and known limitations.

By submitting a contribution, you agree that it is licensed under this repository's MIT license and that you have the right to submit it.

## Content policy

Do not submit:

- unpublished manuscripts or private world bibles;
- production artwork, voice, video or model assets you cannot redistribute;
- secrets, tokens, certificates or signing material;
- copied proprietary code;
- personal data about other people.

Examples added to the repository must be synthetic or explicitly licensed for redistribution.

## Design constraints

- Local-first by default; no silent network or telemetry addition.
- All user-visible product copy must support Chinese and English.
- MCP query tools remain read-only.
- Exports remain deterministic and preserve source revision/hash evidence.
- 3D comic-drama output must remain stylized 3D animation; do not add live-action or photorealistic defaults.
- Any schema change needs validation, migration/compatibility handling and tests.

## Review

Maintainers may request changes for correctness, user safety, cross-platform behavior, accessibility, data compatibility or maintenance cost. A green CI run does not replace review.

## Security

Do not disclose a vulnerability in a public issue. Follow [SECURITY.md](SECURITY.md).
