# Local MCP

IPloom Studio ships a local [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. It exposes the active workspace to compatible clients without uploading the workspace.

## Getting the configuration

1. Open IPloom Studio.
2. Select **MCP** in the top bar.
3. Choose **Copy configuration**.
4. Paste the `mcpServers` object into your client's MCP configuration.

The generated configuration points at:

- the desktop executable;
- the bundled `resources/bin/iploom-mcp` script;
- the active `workspace.json`;
- `ELECTRON_RUN_AS_NODE=1`.

Do not replace the command with `iploom-mcp` alone on macOS or Windows. A clean desktop installation does not require a global MCP binary or a system Node.js runtime.

## Tools

| Tool                     | Read-only | Purpose                                                                                                   |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------- |
| `list_story_worlds`      | yes       | List universes and compact counts                                                                         |
| `get_story_world`        | yes       | Read world rules, cast, places, story objects, factions, lore and relationships                           |
| `list_novels`            | yes       | List novels, optionally filtered by universe                                                              |
| `get_novel`              | yes       | Read novel metadata, chapter plans and statistics                                                         |
| `get_chapter`            | yes       | Read a chapter's full prose, outline, beats and scenes                                                    |
| `search_ip`              | yes       | Search the bilingual IP library                                                                           |
| `get_relationship_graph` | yes       | Return graph nodes, edges, degrees and warnings                                                           |
| `list_timeline_events`   | yes       | List story timeline events with world/novel/chapter/subject/status filters                                |
| `list_workflow_tasks`    | yes       | List AI authoring tasks with readiness, blockers and optional world/novel/status filters                  |
| `get_workflow_brief`     | yes       | Generate a deterministic, task-scoped bilingual Markdown brief, optionally with approved upstream outputs |
| `get_workflow_result`    | yes       | Read a workflow task's bilingual result (full or windowed) and first pre-change snapshot                  |
| `list_standards`         | yes       | List foundation standards with kind, status, scope and in-scope active standard count                     |
| `get_standard`           | yes       | Read one standard, its scope, body windows and workflow tasks that reference its id                       |
| `create_standard`        | no        | Register a foundation standard as a draft (or active) with schema validation                              |
| `update_standard`        | no        | Update a standard; content changes bump its version, status-only changes do not                           |
| `create_timeline_event`  | no        | Create a story timeline event; defaults to `proposed` and validates every reference                       |
| `update_timeline_event`  | no        | Revise an event by id; omitted fields keep their values and references are re-validated                   |
| `save_workflow_result`   | no        | Save produced result text to a workflow task and move it to review                                        |
| `export_arcreel_bundle`  | no        | Write an ArcReel-style handoff package                                                                    |

Tool schemas and descriptions are bilingual. Responses use stable JSON keys and include the workspace revision. The server registers 19 tools: thirteen read-only, five workspace writes (`create_standard`, `update_standard`, `create_timeline_event`, `update_timeline_event`, `save_workflow_result`) and one export (`export_arcreel_bundle`). Those six are the only tools that can change local state; writes are serialized and re-validated against the workspace schema. Tool names and access levels come from `apps/studio/src/core/mcp-tools.ts`, the single source the server, the settings copy and the verification script all share.

### Response shape and paging

Every collection response is a page rather than a bare array:

```json
{
  "total": 243,
  "offset": 0,
  "count": 20,
  "next_offset": 20,
  "truncated": true,
  "items": []
}
```

- List tools accept `offset` and `limit` (default 20, maximum 200); `get_novel` also pages `chapters`, `list_standards` pages `standards`.
- `get_story_world` pages seven collections (novels, characters, locations, story objects, factions, lore, relationships) with one shared `limit` but independent offsets: pass `offsets` (for example `{"characters": 20, "objects": 20, "lore": 40}`) so advancing one collection leaves the others on their own page. Omitted collections start at 0.
- `get_relationship_graph` uses the same idea with top-level `nodes_offset` and `edges_offset`.
- Default responses stay under a roughly 50 KB budget; a page carries fewer items when large entries would exceed it, so `count` can be below `limit`. Opt-ins that ask for a large payload — `get_story_world` or `list_timeline_events` with `include_details`, `list_standards` with `include_body`, or a `max_chars` far above the default — can push a single response past that budget.
- Follow `next_offset` until it is `null`; across all pages every item appears exactly once, and `total` does not change while the workspace revision does not change.
- `search_ip` applies `world_id` and `kind` before ranking, so out-of-scope hits cannot crowd real matches out of the page.
- `get_chapter` windows prose: pass `offset` and `max_chars` (default 6,000) and concatenate `content.text` until `content.next_offset` is `null` to rebuild the full chapter.
- `get_standard` windows bodies the same way with `body_offset` and `body_max_chars` (default 4,000), applied to both `body.zh` and `body.en`. Because each language body has its own length, continue each one from its own `next_offset` via `body_offsets` (`{"zh": 4000, "en": 4002}`); a language omitted from `body_offsets` starts at `body_offset`. A shared offset would skip or repeat text once one language hits a surrogate pair at the cut. Windows never split a surrogate pair: an offset that lands between the two halves is pulled back, and a `max_chars` of 1 returns the whole two-code-unit character.
- `get_workflow_result` supports the same per-language continuation with `offset`, `result_offsets` and `max_chars` (default 4,000). The window applies to the current result and, when present, to the first pre-change snapshot: each becomes its own surrogate-safe window that continues from its own `next_offset`, while sharing the same offsets — a language past its end returns empty text with `next_offset: null`, so lockstep calls reassemble both texts. Without any window argument it returns both texts in full, which stays the expected shape for revision workflows.
- `get_workflow_brief` accepts `include_approved_outputs` (default `false`). When true, the outputs of every approved ancestor task are appended in an "APPROVED DEPENDENCY OUTPUTS" section, using the same stage labels and dependency order the in-app production prompt uses. To keep one huge ancestor from flooding the brief, each output is clipped to an equal share of the remaining `max_chars` window with a `[…truncated]` marker (mirroring the in-app prompt's budget rule). The default call without the flag is unchanged.

### Bounded views and write acknowledgements

Responses echo the fields a client needs for the next call, not every nested list:

- Entity views cap repeated identifiers at 20 items and add the true size alongside: `character_ids`/`character_id_count`, `depends_on_ids`/`depends_on_id_count`, `pinned_by_task_ids`/`pinned_by_task_count`. The last pair belongs to `get_standard`: it counts workflow tasks whose `standardRefs` mention that standard's `id`, not tasks pinned to its exact `version`.
- `get_story_world` returns every stored story-object field: `id`, `world_id`, `name`, `category`, `summary`, `visual_prompt`, `source_notes`, `created_at` and `updated_at`. The default compact view clips long values and names them in `truncated_fields`; `include_details` returns them in full. Story objects are enumerable with `next_offset` alone, without a search keyword.
- The world record in `get_story_world` follows the same rule: the default view clips long `name`, `tagline` and `summary` values and names them in `truncated_fields`, so one verbose world cannot consume the budget its seven collections share; `include_details` returns the world in full.
- `list_timeline_events` orders events by chapter, in-world time, order and creation time; its default view clips long state, evidence and prompt fields and names them in `truncated_fields`, while `include_details` returns the full record.
- `list_workflow_tasks` previews at most 10 unfinished prerequisites in `blockers` and reports the full number in `blocker_count`; the summary object counts all of them.
- `get_workflow_result` is the one workflow read that returns stored text: without window arguments `result` (`{ zh, en }`) holds the current text in full and `previous_result` the first pre-change snapshot, or `null` when none exists. With `offset` / `result_offsets` and `max_chars`, each language becomes a surrogate-safe window (`text`, `total_chars`, `next_offset`, `truncated`) that continues per language, mirroring `get_standard`'s body windows. It never writes or bumps the revision, and each language is bounded by the stored 200,000-character cap.
- `create_standard` and `update_standard` acknowledge with the compact standard view. Bodies are reported as `body_chars` (`{ zh, en }` character counts) rather than echoed back, so a large write does not inflate the response. A language patch merges per language: sending only `title.zh` keeps the existing English title and both bodies.
- `create_timeline_event` and `update_timeline_event` acknowledge with the compact timeline event view: long state, evidence and production-prompt fields are clipped and named in `truncated_fields`. Omitted fields keep their stored values, a title patch merges per language, and `chapter_id: null` clears the chapter together with any scene.
- `save_workflow_result` acknowledges with the compact workflow task view, whose result is reported as `result_chars` and a short `result_excerpt` rather than echoed back. A result patch merges per language: omitting `zh` keeps the stored Chinese text, and an empty string clears one language only while the other still has text. The pre-change snapshot moves to `previous_result_chars`, done dependents are flagged `result_superseded`, and `queued` or `active` tasks become `review`; a `done` task is rejected until it is reopened in the app.
- `export_arcreel_bundle` reports the counts (`chapter_count`, `path_count`, `warning_count`, `totals`) and previews only the first 50 chapters and paths and the first 20 warnings. Read the returned `directory` and `manifest.json` for the complete list; `files_written` remains the authoritative file count.

### Errors

Failures return `isError: true` with a JSON text block that clients can parse:

```json
{
  "error": {
    "code": "invalid_arguments",
    "message": "...",
    "issues": ["query: ..."]
  }
}
```

`issues` is present when the failure carries field-level details: argument parsing, foundation-standard validation and timeline-event validation. Unknown ids — including a story world referenced by `create_standard` or `update_standard`, or a world, novel, chapter, scene, subject or related id referenced by `create_timeline_event` or `update_timeline_event` — and unknown task references return `not_found`. Both keep the connection alive so a client can correct the call without reconnecting.

### Export destination boundary

`export_arcreel_bundle` may only write below the workspace's own `exports` directory. A relative `output_dir` is resolved against the directory that holds `workspace.json`; `exports/sub`, `./exports/sub` and an absolute path inside that directory are all accepted. Absolute paths elsewhere, `..` traversal and symlinked ancestors that resolve outside the allowed roots are rejected before anything is created.

For exports that must live somewhere else, start the server with one or more `--export-root` options:

```sh
bun run studio:mcp --workspace /absolute/path/workspace.json \
  --export-root /absolute/path/other-exports
```

Each root is resolved and compared by real path, and the default workspace `exports` directory stays available. Every bundle's schema is validated in full before the first filesystem write — identifiers, timestamp, SHA-256 digest, media types, file count and total size — so a tampered `output_dir`, `manifestSha256` or timestamp cannot choose the package location. File paths are normalized and checked for traversal and destination escape while the package is written into a staging directory, which is renamed into place only after every file is written.

## Example prompts

```text
List my story worlds, then summarize the unused reusable cast in Mist Harbor.
```

```text
Read novel work_tide_clock and identify chapters whose relationship context
does not match the world graph. Do not rewrite the prose.
```

```text
Export chapters 1 and 2 of work_tide_clock as an ArcReel bundle.
```

```text
Add a proposed timeline event for chapter 2 where Lin Zhou takes
the night watch, then mark it canon after I confirm the details.
```

```text
List tasks that are ready to start, then give me the full brief for the
highest-priority 3D comic-drama adaptation task.
```

## Command-line check

On macOS:

```sh
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/IPloom Studio.app/Contents/MacOS/IPloom Studio" \
  "/Applications/IPloom Studio.app/Contents/Resources/bin/iploom-mcp" \
  --workspace "$HOME/Library/Application Support/IPloom Studio/workspace.json"
```

On Windows PowerShell:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "$env:LOCALAPPDATA\Programs\IPloom Studio\IPloom Studio.exe" `
  "$env:LOCALAPPDATA\Programs\IPloom Studio\resources\bin\iploom-mcp" `
  --workspace "$env:APPDATA\IPloom Studio\workspace.json"
```

The command waits for MCP messages on stdin. It is not an interactive CLI; use an MCP client to communicate with it.

## Development

```sh
bun run studio:mcp --workspace /absolute/path/workspace.json
bun run studio:build:release
bun run studio:verify-mcp
```

`studio:verify-mcp` starts the bundled server through the Electron runtime and exercises all tool registration plus a temporary export.

## Safety

The server reads the workspace on every call. It only changes local state through `create_standard`, `update_standard`, `create_timeline_event`, `update_timeline_event`, `save_workflow_result` and `export_arcreel_bundle`. It does not call a model, network service or cloud API. MCP clients can still read all text in the active workspace, so only connect clients you trust.

That text includes imported manuscripts and lore, which are third-party content. `get_chapter` returns full prose, and the world and search tools return lore and asset text verbatim. Treat imported content as a prompt-injection surface: an MCP agent may read instructions embedded in it, and neither the server nor the app can prevent the client's model from acting on them. Expose the workspace only to agents whose behavior and permissions you accept, and treat their conclusions as proposals that need author review.

Every response that carries workspace metadata includes `workspace.recovered_from_backup`. When it is `true`, the primary `workspace.json` was unreadable and the server loaded the `.bak` copy instead; the response also carries `workspace.rejected_primary_file` and `workspace.rejected_primary_reason` naming the quarantined file. Treat such a response as recovery data rather than the newest state, and inspect the quarantined file before relying on the reported revision.
