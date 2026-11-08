# IPloom Studio

**Build an IP bible. Write novels from it. Hand the result to a 3D comic-drama pipeline.**

[![Studio CI](https://github.com/j4tmr/iploom/actions/workflows/studio-ci.yml/badge.svg)](https://github.com/j4tmr/iploom/actions/workflows/studio-ci.yml)
[![Latest release](https://img.shields.io/github/v/release/j4tmr/iploom?display_name=tag&sort=semver)](https://github.com/j4tmr/iploom/releases)

[中文说明](README.zh-CN.md) · [Product guide](https://j4tmr.github.io/iploom/) · [Releases](https://github.com/j4tmr/iploom/releases) · [Architecture](docs/architecture.md) · [MCP](docs/mcp.md) · [ArcReel handoff](docs/arcreel-handoff.md)

IPloom Studio is a local-first desktop workspace for keeping a story world, its reusable cast, relationship graph, novels, chapters and screen-adaptation material in one coherent system. It runs on macOS and Windows, stores content on your machine, and exposes the same source of truth to local MCP clients.

![IPloom Studio dashboard](docs/images/dashboard.png)

![IPloom Studio AI workflow](docs/images/workflow.png)

## Why it exists

Most writing tools start with a document. Screen adaptation then starts again from a script, a character sheet, and a pile of disconnected notes. IPloom starts one level earlier:

```text
IP universe
  ├─ rules, places, factions, lore
  ├─ reusable cast shared across universes
  ├─ relationship graph
  └─ novels
       ├─ outline and chapter cards
       ├─ prose, beats and revision status
       └─ episode + storyboard handoff
```

The result is a small, inspectable IP graph instead of a folder of files whose relationships only exist in the author's head.

## Features

- **Bilingual workspace** — Chinese and English UI, bilingual names, titles, loglines and character fields.
- **World-to-novel hierarchy** — many novels can inherit one world's cast, places, factions, lore and relationships.
- **Reusable cast** — one character can belong to several universes and be marked as reusable.
- **Relationship map** — deterministic graph layout with relationship type, direction, strength, status and warnings.
- **AI workflow** — hierarchical authoring tasks, explicit dependencies, readiness states, result capture and scoped bilingual briefs for local MCP assistants.
- **Manuscript editor** — chapters, summaries, outlines, beats, POV, cast, location, prose and approval state.
- **Novel shelf** — cross-universe filtering, search, status filters and word-count sorting.
- **Local persistence** — atomic `workspace.json` writes, a `.bak` recovery copy, schema migration, a save-before-close handshake and visible save state.
- **ArcReel-style handoff** — selected chapters become a directory of world, episode and storyboard JSON plus a Markdown handoff.
- **Foundation standards** — project-wide language, format, naming, numeric, entity-prompt and continuity rules, optionally AI-drafted, injected into every prompt and workflow brief with pinned versions.
- **Local MCP server** — seventeen tools for IP queries, story timeline events, foundation rules, workflow briefs and handoff export; twelve are read-only and four write workspace records.
- **Desktop security baseline** — context isolation, sandboxed renderer, strict CSP, validated IPC and an explicit export boundary.
- **No account and no telemetry** — the app does not require a cloud service.

## New AI production desk

Import existing manuscripts, analyze world/cast/relationships/scenes through a configurable model API, and use nine editable prompt templates with dependent tasks, streamed output and author review. See the [AI production guide](docs/ai-production.md). These features ship in the 0.6.0 installers below.

## Download

Current release **0.6.0** — direct downloads:

| macOS (Apple silicon + Intel)                                                                                                                                                                                                     | Windows x64                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [DMG](https://github.com/j4tmr/iploom/releases/download/studio-v0.6.0/IPloom-Studio-0.6.0-darwin-universal.dmg) · [ZIP](https://github.com/j4tmr/iploom/releases/download/studio-v0.6.0/IPloom-Studio-0.6.0-darwin-universal.zip) | [EXE](https://github.com/j4tmr/iploom/releases/download/studio-v0.6.0/IPloom-Studio-0.6.0-win32-x64.exe) |

[Releases](https://github.com/j4tmr/iploom/releases) · [SHA256SUMS.txt](https://github.com/j4tmr/iploom/releases/download/studio-v0.6.0/SHA256SUMS.txt)

- macOS: universal DMG and ZIP for Apple silicon and Intel.
- Windows: x64 NSIS installer.
- `SHA256SUMS.txt`: verify the downloaded asset before opening it.
- **Build provenance**: each `.dmg`, `.zip` and `.exe` is attested by the release workflow. Verify one with the GitHub CLI:

  ```sh
  gh attestation verify IPloom-Studio-0.6.0-darwin-universal.dmg --repo j4tmr/iploom
  ```

The current release is **unsigned**. macOS Gatekeeper and Windows SmartScreen may show a warning. On macOS 15 and later, Control-click → Open no longer bypasses Gatekeeper: if the first launch is blocked, open **System Settings → Privacy & Security**, click **Open Anyway** next to the IPloom Studio message, authenticate, then choose **Open**. On Windows, use **More info → Run anyway**. Verify the checksum and attestation first, and continue only when you trust the source. Signed builds can be added later without changing the application format.

## Quick start

Prerequisites: Bun 1.4.2, Node.js 24, and the platform dependencies required by Electron.

```sh
bun install --frozen-lockfile
bun run dev
```

Run the complete local verification:

```sh
bun run check
bun run studio:smoke
```

Create a local installer:

```sh
bun run studio:package
```

The build output is written to `release/`. Generated app data stays in the platform application-data directory and is never copied into Git.

## MCP and adaptation

Open **MCP** in the top bar to copy a ready-to-use stdio configuration. The packaged server runs through the application's Electron runtime, so a separate Node.js installation is not required.

Read:

- [MCP integration](docs/mcp.md)
- [ArcReel handoff format](docs/arcreel-handoff.md)
- [Architecture and data model](docs/architecture.md)

ArcReel is used here as the name of a compatible handoff target. This project is not an official ArcReel product or an official integration claim.

## Scope and limits

- IPloom Studio is an authoring and handoff tool, not an image/video generator.
- Automatically derived scenes and shots are director drafts and require author review.
- The app has no cloud sync, collaboration server, telemetry or account system.
- Workspace files are local JSON. Keep backups and use full-disk encryption for private material.
- The first release is unsigned; this is disclosed in every release note.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and focused pull requests are welcome. Do not submit private manuscripts, production assets, credentials or material you cannot redistribute.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
