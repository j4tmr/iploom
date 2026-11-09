# Architecture

IPloom Studio is an Electron application with a React renderer, a narrow preload bridge, a local Node main process, and an optional stdio MCP surface. The design keeps story data portable and keeps the adaptation path derived rather than duplicated.

## System map

```text
React renderer
  ├─ workspace editor
  ├─ relationship graph
  ├─ AI workflow and scoped briefs
  ├─ manuscript editor
  ├─ export preview
  └─ MCP configuration
        │
        ▼ contextBridge / typed IPC
Electron main process
  ├─ atomic workspace store
  ├─ native folder picker
  ├─ ArcReel package writer
  ├─ model API client (key held in memory)
  └─ MCP configuration
        │                         │
        ▼ stdio                   ▼ HTTPS / loopback HTTP
Bundled MCP server         Configured Chat Completions endpoint
  ├─ thirteen read-only tools
  ├─ create_standard / update_standard
  ├─ create_timeline_event / update_timeline_event
  ├─ save_workflow_result
  └─ export_arcreel_bundle
     (19 tools total, from core/mcp-tools.ts)
```

No renderer code receives Node.js primitives. IPC handlers validate the sender against the trusted renderer URL; model configuration and model requests are validated with strict schemas, and workspace saves pass through the store's full schema and referential validation before any write. File boundaries are enforced separately, as described under [Security boundary](#security-boundary). The renderer is sandboxed with context isolation enabled and a restrictive Content Security Policy.

## Domain model

`StudioWorkspace` is the root aggregate:

- `universes`: the IP container. World rules, places, factions and lore belong to one universe.
- `characters`: belong to one or more universes. `reusable` marks cast intended for cross-world use.
- `relationships`: character edges scoped to a universe, with type, direction, strength and status.
- `works`: novels. A work references exactly one universe.
- `chapters`: ordered content inside a work, with planning notes, prose, cast, location and optional scenes.
- `workflowTasks`: hierarchical AI-authoring work items with explicit dependencies, readiness, scope references and reviewable results.
- `standards`: project foundation rules (language, format, naming, numeric, entity-prompt and continuity). Active, in-scope standards and their current id/version are resolved when production prompts and workflow briefs are composed; new tasks record those ids and versions as informational `standardRefs`. A recorded ref that no longer matches the live registration (updated version, disabled, out of scope or removed) is derived at display and composition time, never stored: workflow and foundation views mark it, and the brief adds a "Foundation reference notice" listing each mismatch while still applying the current active rules.
- `ruleSystems`, `abilityTemplates` and `itemStatTemplates`: universe-scoped structured rule systems with ordered tiers and typed attributes, plus their linked ability and item-stat templates. Active, in-scope systems and linked templates are serialized as prompt data, not instructions.
- `exports`: local history of generated handoff packages.

The schema is validated at both UI and storage boundaries. Duplicate IDs, duplicate chapter numbers, dangling universe/character/location references, task cycles and invalid task scope are rejected before data is written. Migration runs on load as a chain: v1 adds the workflow collection (v2), v2 adds story objects and timeline events (v3), v3 adds foundation standards with empty task refs (v4), v4 repairs the export history against the works it references (v5), v5 strips composed model prompts that older builds had written back into workflow task briefs and deliverables (v6), v6 pins an inferred prompt template on workflow tasks whose title, brief or kind identifies the stage (v7), and v7 adds empty structured rule-layer collections without changing prose standards or content (v8). Every step bumps the revision.

## Persistence

The desktop app writes a single `workspace.json`:

1. Validate the complete workspace.
2. Serialize overlapping saves so the last accepted snapshot cannot be overtaken by an earlier write.
3. Write a temporary file with mode `0600`.
4. Copy the previous primary file to `workspace.json.bak`.
5. Atomically rename the new file into place.

The loader tries the primary file first and falls back to `.bak`. A visible banner reports recovery. When the window or application closes, the main process requests a final renderer save and waits for an explicit completion acknowledgement before closing. This protects against truncated writes, crashes and closing during the debounce window; it is not a replacement for user backups or disk encryption.

Browser preview mode uses `localStorage` and is intended only for UI development.

## ArcReel handoff

The export path takes an immutable workspace revision and produces:

```text
<novel>-<timestamp>-<hash>-arcreel/
  manifest.json
  world.json
  production-structure.json
  episodes/*.json
  storyboards/*.storyboard.json
  production/approved-designs.json
  handoff.md
```

The package is assembled as a set of in-memory files, validated, then written into a staging directory and atomically renamed. A second export never overwrites an existing package directory.

`production/approved-designs.json` uses schema `iploom.production-designs/v1` and carries the completed, author-reviewed text designs and reusable prompts for the exported work; selection rules are in [ArcReel handoff](arcreel-handoff.md#approved-designs).

`storyboards/*.storyboard.json` is validated against the included contract-4 subset before writing. Scene and shot sequences are generated from array position instead of parsed from user-editable IDs. This keeps exported identifiers stable even when a scene has a nonnumeric ID.

See [ArcReel handoff](arcreel-handoff.md) for the exact boundary.

## AI workflow

Workflow tasks form a separate tree from the story hierarchy. A task can point at a universe, work, chapter and reusable cast, while `parentId` expresses decomposition and `dependsOnIds` expresses readiness. Dependencies are validated against cycles and missing tasks.

Each task can produce a deterministic Markdown brief. The brief includes only the selected task's scope: objective, deliverable, parent/children, dependency state, the referenced world, novel, chapter, cast, lore, places, factions and relationships. It also carries the project's stylized 3D animation boundary when adaptation work is in scope, and optionally the clipped outputs of every approved ancestor task (an opt-in for MCP clients via `include_approved_outputs`, mirroring the in-app production prompt). The same generator powers the copy action in the app and the `get_workflow_brief` MCP tool.

## Model API

The model client lives in the main process (`apps/studio/src/node/ai-client.ts`); the renderer composes a prompt and sends it over typed IPC. A run is possible only after the author configures **Settings → Model API** and confirms the send: the production desk displays the exact, editable prompt, and the confirmation names the endpoint and model. The import analyzer likewise names the endpoint, model and request count, and caps an import at 40 analysis requests. There is no background, scheduled or automatic transmission, and no automatic retry beyond one resend without `stream_options` after a 400/422 that names it.

What is sent is the composed prompt: task instructions, foundation standards, the selected world's rules and asset records, chapter prose and outline, relationship, timeline and location context, and the results of dependency tasks the author marked done. The prompt is shown and editable before sending, and is not stored in the workspace; runs record only metadata (`lastRun`: model, prompt hash, source revision, timestamp). Output arrives as a workflow draft for review and never replaces a chapter or approved asset automatically.

The API key is held in a main-process module variable for the current session. It is never written to `workspace.json`, exports or the filesystem, and the configuration IPC returns only endpoint, model and a configured flag to the renderer. Endpoint validation accepts HTTPS, or plain HTTP only on `localhost`, `127.0.0.1` or `[::1]`, and rejects credentials, query strings and fragments. Requests use `redirect: "error"`, so a redirect cannot forward the prompt or bearer token to another origin. Requests go directly from the local main process to the configured endpoint; its operator receives the manuscript under its own retention policy, which IPloom does not control.

## MCP

The MCP server is bundled by esbuild and run through the Electron executable with `ELECTRON_RUN_AS_NODE=1`. This matters on clean installs:

- a separate system Node.js is not required;
- Windows can spawn the `.exe` directly rather than failing on a `.cmd` shim;
- the server is bundled with its JavaScript dependencies.

The thirteen read-only tools, including timeline listing, workflow listing, brief generation, full workflow-result reads and foundation-standard reads, never write. `create_standard` and `update_standard` only change foundation standards inside the workspace, while `create_timeline_event` and `update_timeline_event` add or revise story timeline events, defaulting to `proposed` and re-validating every reference before saving. `save_workflow_result` writes produced result text back to an existing workflow task and moves it to review, keeping the pre-change text in `previousResult`; a task already approved as done must be reopened in the app first. `get_workflow_result` is the only read that returns stored workflow text verbatim: the current bilingual result plus the first pre-change snapshot, capped per language at the stored 200,000-character limit, with optional per-language windows when a client only wants to sample the text — the window applies to both texts, each continuing from its own `next_offset`. `export_arcreel_bundle` is the only tool that creates files and defaults to an `exports` directory beside the workspace. Its `output_dir` is confined to that directory plus any explicit `--export-root` arguments, compared by real path; each bundle is schema-validated in full before the first write, and per-file paths are checked while it is assembled in a staging directory.

All 19 tool names and access levels live in `apps/studio/src/core/mcp-tools.ts`; the server asserts its registration order against that list, so the settings copy, the docs and the verification script cannot drift apart. Collection responses are paged (`total`, `offset`, `count`, `next_offset`, `truncated`, `items`) under a per-response byte budget, multi-collection reads page each collection at its own offset, and large prose or rule bodies are returned as reassemblable character windows that never split a surrogate pair. `get_standard` carries a per-language continuation offset, because a window can end at a different character count in each language when the cut meets a surrogate pair. `search_ip` filters by world and kind before ranking. Invalid arguments and unknown ids return parseable `{ "error": { "code", "message", "issues?" } }` payloads rather than killing the stdio connection; a story world referenced by a write tool must exist and is reported as `not_found` when it does not.

## Security boundary

Desktop policy lives in `apps/studio/src/node/desktop-guards.ts`, which imports no Electron API so the main process, the MCP server and tests all exercise the same code.

- No remote content is loaded by the renderer.
- Navigation and new-window requests are intercepted.
- Permission requests are denied.
- Only credential-free HTTP(S) links can be opened externally.
- “Open folder” reveals a file or directory only when its real path stays inside a location the main process created (the workspace directory and its `snapshots` directory), refuses application bundles, and never derives locations from renderer-writable export records.
- Export file paths are normalized and checked against directory traversal; the package directory must sit exactly one level below the selected destination.
- ArcReel bundles arriving over IPC or MCP are schema-validated in full — identifiers, timestamp, SHA-256 digest, media types, file count and total size — before any filesystem write.
- Model requests go only to the configured Chat Completions endpoint over HTTPS or loopback HTTP, use `redirect: "error"`, and are never sent without an explicit author action and confirmation.
- The model API key stays in main-process memory for the session and is excluded from the renderer, workspace files and exports.
- Imported manuscripts and lore are included verbatim in model prompts and exposed through MCP tools; they are treated as a prompt-injection surface, and model output is reviewable data rather than an instruction.
- Content, credentials and generated packages are excluded from Git.

See [SECURITY.md](../SECURITY.md) for reporting.

## Coverage

`bun run test:coverage` enforces `coverageThreshold` from [bunfig.toml](../bunfig.toml) per file — bun 1.4 rejects the run when any measured file drops below the floor, even if the totals are higher. Security-relevant code stays inside that gate: the desktop guards (`apps/studio/src/node/desktop-guards.ts`), the workspace store, the AI client and the MCP server are all measured. The stdio MCP suite spawns the server as a subprocess, which coverage cannot observe, so `tests/studio/mcp-server-inline.test.ts` drives the same registered tools over an in-memory transport inside the test process. `tests/studio/mcp-paging.test.ts` builds an oversized workspace (243 chapters, 24 maximal worlds, 60 decoy lore entries, a 20,000-character standard body) to pin response budgets, page completeness, scoped search and exact prose reassembly.

Files listed in `coveragePathIgnorePatterns` are excluded because they cannot be meaningfully measured in a bun test process, not because their logic is untested:

- `apps/studio/electron/main.ts` imports `electron` at module load; the policy it applies lives in `desktop-guards.ts`, which is fully covered.
- `apps/studio/src/platform.ts` is the renderer bridge to `window.iploom`, which only exists inside Electron; unit tests mock the calls they exercise.
- `apps/studio/src/components/forms.tsx`, `manuscript-import.tsx`, `production-panel.tsx`, `search-overlay.tsx`, `ui.tsx` and `apps/studio/src/views/workflow-view.tsx` are interaction-heavy UI surfaces covered by `studio:smoke` and manual QA; the extractable logic behind them lives in dedicated modules with their own tests.
- `apps/studio/src/components/scene-editor.tsx`, `apps/studio/src/views/cast-library.tsx` and `apps/studio/src/views/work-view.tsx` are the same kind of interaction-heavy surfaces; `tests/studio/a11y-residual.test.tsx` exercises their accessibility behaviors without dragging the whole components under the per-file floor.
- `apps/studio/src/components/ai-settings.tsx`, `update-settings.tsx` and `apps/studio/src/views/settings-view.tsx` are bridge-driven settings surfaces: their Electron work goes through `bridge` (`platform.ts`, unmeasurable here), while the underlying logic lives in the measured `core/updates.ts` and `node/ai-client.ts`, and the workspace-reset/save-race behavior they expose is pinned by `tests/studio/settings-view-reset.test.tsx`.
