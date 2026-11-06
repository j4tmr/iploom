# Development

## Requirements

- Bun 1.4.2
- Node.js 24 for the toolchain
- macOS 12+ or Windows 10/11
- Platform libraries required by Electron

The Electron application bundles its own Node runtime. A separate Node.js installation is only a development-toolchain requirement.

## Setup

```sh
bun install --frozen-lockfile
bun run dev
```

Development opens a Vite renderer on loopback and launches Electron against it. The active workspace defaults to `.studio/workspace.json` in the repository and is ignored by Git.

## Verification

```sh
bun run typecheck
bun run test
bun run studio:build:release
bun run studio:verify-mcp
bun run studio:smoke
```

On a Linux CI runner, wrap the GUI smoke with Xvfb:

```sh
xvfb-run -a bun run studio:smoke
```

The packaged smoke:

```sh
bun run studio:package
bun run studio:smoke:package
```

The smoke test creates a temporary workspace, opens the real renderer in a hidden Electron window, waits for `.studio-shell`, checks that navigation and content are present, then exits.

## Source map

```text
apps/studio/src/core/       pure domain, validation, graph, search, ArcReel
apps/studio/src/node/       workspace persistence and MCP configuration
apps/studio/src/views/      workspace pages
apps/studio/src/components/ forms, graph, shell, search
apps/studio/electron/       main process, IPC and preload bridge
apps/studio/mcp/            stdio MCP server
scripts/studio/             build, dev, smoke and MCP verification
tests/studio/               domain, persistence and real stdio MCP tests
```

## Data rules

- Do not commit `.studio/`, `workspace.json`, exports, manuscripts or private assets.
- New document fields require schema, factory defaults and migration behavior.
- Validate at the persistence boundary, not only in forms.
- Keep exports deterministic: stable ordering, explicit timestamps and hashes.
- MCP query tools must remain read-only.
- Any new write tool must document its local file scope and receive tests.

## UI

The renderer uses React 19 and Vite. It has no router package; navigation is typed in `routes.ts`. The app supports light/dark/system themes and Chinese/English UI copy.

For a visual check:

```sh
IPLOOM_STUDIO_SMOKE_SCREENSHOT="$PWD/docs/images/dashboard.png" \
  bun run studio:smoke
```

## Packaging

`scripts/studio/build.ts` builds:

- the Vite renderer;
- Electron main/preload bundles;
- a bundled MCP server;
- a minimal app directory and package metadata.

`scripts/studio/electron-builder.mjs` produces a universal macOS DMG/ZIP and a Windows x64 NSIS installer. Build resources live in `apps/studio/build/`.

See [Releasing](releasing.md).
