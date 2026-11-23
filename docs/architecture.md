# Architecture

IPloom Studio is an Electron application with a React renderer, a narrow preload bridge, a local Node main process, and an optional stdio MCP surface. The design keeps story worlds, works and agent handoff tasks in one local, portable data store.

## System map

```text
React renderer
  ├─ workspace editor
  ├─ relationship graph
  ├─ AI workflow and scoped briefs
  ├─ manuscript editor
  └─ MCP configuration
        │
        ▼ contextBridge / typed IPC
Electron main process
  ├─ atomic workspace store
  ├─ model API client (key held in memory)
  └─ MCP configuration
        │                         │
        ▼ stdio                   ▼ HTTPS / loopback HTTP
Bundled MCP server         Configured Chat Completions endpoint
  ├─ eighteen read-only tools (incl. card reads, rule-layer reads & consistency check)
  ├─ create_standard / update_standard
  ├─ create_timeline_event / update_timeline_event
  ├─ save_workflow_result
  ├─ create_rule_system / update_rule_system
  └─ upsert_ability_template / upsert_item_stat_template / set_entity_rule_binding
     (28 tools total, from core/mcp-tools.ts)
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
- `ruleSystems`, `abilityTemplates` and `itemStatTemplates`: universe-scoped structured rule systems with ordered tiers and typed attributes, plus their linked ability and item-stat templates. Characters can carry per-system `ruleBindings` (tier, typed attribute values and ability references) and story objects can carry a `ruleBinding` (item stat template, tier and stat effects), all validated against the rule system at save time. Active, in-scope systems and linked templates are serialized as structured prompt data (not instructions), included in workflow briefs, and audited against prose/designs via deterministic consistency checks.
- `cardTypes`, `cards`, `cardEdges` and `constructs`: universe- and work-scoped data-driven card types (`icon`, `color`, ordered `fields`, and a `behavior` key whose unknown values safely fall back to `"generic"`), typed card instances, labelled relations and applied starter packs.

The schema is validated at both UI and storage boundaries. Duplicate IDs, duplicate chapter numbers, dangling universe/character/location/rule references, out-of-bounds attribute values, task cycles and invalid task scope are rejected before data is written. Migration runs on load as a chain: v1 adds the workflow collection (v2), v2 adds story objects and timeline events (v3), v3 adds foundation standards with empty task refs (v4), v4 clears dangling `lastOpenedWorkId` references (v5), v5 strips composed model prompts that older builds had written back into workflow task briefs and deliverables (v6), v6 pins an inferred prompt template on workflow tasks whose title, brief or kind identifies the stage (v7), v7 adds empty structured rule-layer collections without changing prose standards or content (v8), v8 adds empty node/card collections (v9), v9 scopes node types and constructs to a universe (v10), v10 adds `work.kind` defaulting legacy works to `novel` (v11), v11 drops the removed exporter's `exports` history and `defaultAspectRatio` / `exportApprovedOnly` settings (v12, destructive for saved export history), v12 backfills `icon` and `behavior` on card types (v13), v13 enables optional `foundationBypass` records on works and chapters without rewriting existing entries (v14), and v14 enables optional structured `ruleBindings` on characters and `ruleBinding` on story objects without modifying existing prose or entities (v15). Every step bumps the revision. First launch starts with a blank workspace (`createEmptyWorkspace`) while starter packs and demo-workspace reset remain explicit opt-ins.

## Persistence

The desktop app writes a single `workspace.json`:

1. Validate the complete workspace.
2. Serialize overlapping saves so the last accepted snapshot cannot be overtaken by an earlier write.
3. Write a temporary file with mode `0600`.
4. Copy the previous primary file to `workspace.json.bak`.
5. Atomically rename the new file into place.

The loader tries the primary file first and falls back to `.bak`. A visible banner reports recovery. When the window or application closes, the main process requests a final renderer save and waits for an explicit completion acknowledgement before closing. This protects against truncated writes, crashes and closing during the debounce window; it is not a replacement for user backups or disk encryption.

Browser preview mode uses `localStorage` and is intended only for UI development.

## AI workflow

Workflow tasks form a separate tree from the story hierarchy. A task can point at a universe, work, chapter and reusable cast, while `parentId` expresses decomposition and `dependsOnIds` expresses readiness. Dependencies are validated against cycles and missing tasks.

Each task can produce a deterministic Markdown brief. The brief includes only the selected task's scope: objective, deliverable, parent/children, dependency state, the referenced world, novel, chapter, cast, lore, places, factions and relationships. It also carries the project's stylized 3D animation boundary when adaptation work is in scope, and optionally the clipped outputs of every approved ancestor task (an opt-in for MCP clients via `include_approved_outputs`, mirroring the in-app production prompt). The same generator powers the copy action in the app and the `get_workflow_brief` MCP tool.

## Model API

The model client lives in the main process (`apps/studio/src/node/ai-client.ts`); the renderer composes a prompt and sends it over typed IPC. A run is possible only after the author configures **Settings → Model API** and confirms the send: the production desk displays the exact, editable prompt, and the confirmation names the endpoint and model. The import analyzer likewise names the endpoint, model and request count, and caps an import at 40 analysis requests. There is no background, scheduled or automatic transmission, and no automatic retry beyond one resend without `stream_options` after a 400/422 that names it.

What is sent is the composed prompt: task instructions, foundation standards, the selected world's rules and asset records, chapter prose and outline, relationship, timeline and location context, and the results of dependency tasks the author marked done. The prompt is shown and editable before sending, and is not stored in the workspace; runs record only metadata (`lastRun`: model, prompt hash, source revision, timestamp). Output arrives as a workflow draft for review and never replaces a chapter or approved asset automatically.

The API key is held in a main-process module variable for the current session. It is never written to `workspace.json` or the filesystem, and the configuration IPC returns only endpoint, model and a configured flag to the renderer. Endpoint validation accepts HTTPS, or plain HTTP only on `localhost`, `127.0.0.1` or `[::1]`, and rejects credentials, query strings and fragments. Requests use `redirect: "error"`, so a redirect cannot forward the prompt or bearer token to another origin. Requests go directly from the local main process to the configured endpoint; its operator receives the manuscript under its own retention policy, which IPloom does not control.

## MCP

The MCP server is bundled by esbuild and run through the Electron executable with `ELECTRON_RUN_AS_NODE=1`. This matters on clean installs:

- a separate system Node.js is not required;
- Windows can spawn the `.exe` directly rather than failing on a `.cmd` shim;
- the server is bundled with its JavaScript dependencies.

The eighteen read-only tools, including card-type and card-instance listing (`list_card_types`, `list_cards`), timeline listing, workflow listing, brief generation, full workflow-result reads, foundation-standard reads, structured rule-system reads and rule-consistency checks, never write. `create_standard` and `update_standard` only change foundation standards inside the workspace, while `create_timeline_event` and `update_timeline_event` add or revise story timeline events, defaulting to `proposed` and re-validating every reference before saving. `save_workflow_result` writes produced result text back to an existing workflow task and moves it to review, keeping the pre-change text in `previousResult`; a task already approved as done must be reopened in the app first. `create_rule_system`, `update_rule_system`, `upsert_ability_template`, `upsert_item_stat_template` and `set_entity_rule_binding` manage structured rule systems, templates and character/object bindings with full schema and referential validation (new rule systems default to `draft`). `get_workflow_result` is the only read that returns stored workflow text verbatim: the current bilingual result plus the first pre-change snapshot, capped per language at the stored 200,000-character limit, with optional per-language windows when a client only wants to sample the text — the window applies to both texts, each continuing from its own `next_offset`.

All 28 tool names and access levels live in `apps/studio/src/core/mcp-tools.ts`; the server asserts its registration order against that list, so the settings copy, the docs and the verification script cannot drift apart. Collection responses are paged (`total`, `offset`, `count`, `next_offset`, `truncated`, `items`) under a per-response byte budget, multi-collection reads page each collection at its own offset, and large prose or rule bodies are returned as reassemblable character windows that never split a surrogate pair. `get_standard` carries a per-language continuation offset, because a window can end at a different character count in each language when the cut meets a surrogate pair. `search_ip` filters by world and kind before ranking. Invalid arguments and unknown ids return parseable `{ "error": { "code", "message", "issues?" } }` payloads rather than killing the stdio connection; a story world referenced by a write tool must exist and is reported as `not_found` when it does not.

## Security boundary

Desktop policy lives in `apps/studio/src/node/desktop-guards.ts`, which imports no Electron API so the main process and tests exercise the same code.

- No remote content is loaded by the renderer.
- Navigation and new-window requests are intercepted.
- Permission requests are denied.
- Only credential-free HTTP(S) links can be opened externally.
- “Open folder” reveals a file or directory only when its real path stays inside a location the main process owns (the workspace directory and its `snapshots` directory), and refuses application bundles.
- Model requests go only to the configured Chat Completions endpoint over HTTPS or loopback HTTP, use `redirect: "error"`, and are never sent without an explicit author action and confirmation.
- The model API key stays in main-process memory for the session and is excluded from the renderer and workspace files.
- Imported manuscripts and lore are included verbatim in model prompts and exposed through MCP tools; they are treated as a prompt-injection surface, and model output is reviewable data rather than an instruction.
- Content and credentials are excluded from Git.

See [SECURITY.md](../SECURITY.md) for reporting.

## Coverage

`bun run test:coverage` enforces `coverageThreshold` from [bunfig.toml](../bunfig.toml) per file — bun 1.4 rejects the run when any measured file drops below the floor, even if the totals are higher. Security-relevant code stays inside that gate: the desktop guards (`apps/studio/src/node/desktop-guards.ts`), the workspace store, the AI client and the MCP server are all measured. The stdio MCP suite spawns the server as a subprocess, which coverage cannot observe, so `tests/studio/mcp-server-inline.test.ts` drives the same registered tools over an in-memory transport inside the test process. `tests/studio/mcp-paging.test.ts` builds an oversized workspace (243 chapters, 24 maximal worlds, 60 decoy lore entries, a 20,000-character standard body) to pin response budgets, page completeness, scoped search and exact prose reassembly.

Files listed in `coveragePathIgnorePatterns` are excluded because they cannot be meaningfully measured in a bun test process, not because their logic is untested:

- `apps/studio/electron/main.ts` imports `electron` at module load; the policy it applies lives in `desktop-guards.ts`, which is fully covered.
- `apps/studio/src/platform.ts` is the renderer bridge to `window.iploom`, which only exists inside Electron; unit tests mock the calls they exercise.
- `apps/studio/src/components/forms.tsx`, `manuscript-import.tsx`, `production-panel.tsx`, `search-overlay.tsx`, `ui.tsx` and `apps/studio/src/views/workflow-view.tsx` are interaction-heavy UI surfaces covered by `studio:smoke` and manual QA; the extractable logic behind them lives in dedicated modules with their own tests.
- `apps/studio/src/components/scene-editor.tsx` and `apps/studio/src/views/work-view.tsx` are the same kind of interaction-heavy surfaces; `tests/studio/a11y-residual.test.tsx` exercises their accessibility behaviors without dragging the whole components under the per-file floor.
- `apps/studio/src/components/about-settings.tsx`, `ai-settings.tsx` and `apps/studio/src/views/settings-view.tsx` are bridge-driven settings surfaces: their Electron work goes through `bridge` (`platform.ts`, unmeasurable here), while the underlying logic lives in the measured `core/updates.ts` and `node/ai-client.ts`, and the rendering/state behavior they expose is pinned by `tests/studio/about-settings.test.tsx` and `tests/studio/settings-view-reset.test.tsx`.
