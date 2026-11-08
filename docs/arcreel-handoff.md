# ArcReel-style handoff

IPloom exports a self-contained directory intended to be read by ArcReel-like storyboard, motion-comic and stylized 3D animation tools. “ArcReel” here describes a compatible handoff format and target; this repository does not claim an official ArcReel integration.

## Package layout

```text
the-tide-clock-20261106-030000-a1b2c3d4-arcreel/
  manifest.json
  world.json
  production-structure.json
  handoff.md
  episodes/
    0001-the-tide-clock.json
    0002-...
  storyboards/
    0001-the-tide-clock.storyboard.json
    0002-...
  production/
    approved-designs.json
```

The directory name keeps the work title's Chinese characters and appends the manifest hash prefix; a Chinese-titled work therefore yields a Chinese slug such as `潮汐钟-...`. Repeated exports of the same content receive a numeric suffix instead of overwriting an earlier package. `handoff.md` lists every file path in the package.

## Manifest

`manifest.json` is the integrity and provenance root:

```json
{
  "schema": "iploom.arcreel.manifest/v1",
  "generated_at": "2026-11-06T03:00:00.000Z",
  "content_sha256": "<64 hex characters>",
  "generator": {
    "name": "IPloom Studio",
    "version": "0.4.0",
    "homepage": "https://github.com/j4tmr/iploom"
  },
  "source": {
    "workspace_id": "workspace_demo",
    "workspace_revision": 7,
    "universe_id": "uni_mist_harbor",
    "work_id": "work_tide_clock"
  },
  "adaptation": {
    "style": "stylized-3d-animation",
    "aspect_ratio": "9:16",
    "totals": {
      "chapters": 3,
      "words": 757,
      "scenes": 3,
      "shots": 15
    }
  },
  "files": []
}
```

The `files` array records every non-manifest file with byte length and SHA-256. `content_sha256` hashes the same manifest body without `generated_at` and `content_sha256` itself, so two exports of identical content share one content hash even though their timestamps differ. `manifestSha256` is computed from the serialized manifest (timestamp included) and exposed in the app and MCP response; only that value is used in the export directory suffix.

## Episode files

Each episode is immutable for the exported revision. It includes:

- source workspace, universe, novel, chapter and prose hashes;
- chapter title, language, summary, outline, beats and prose;
- cast anchors and scene-level location;
- relationship context relevant to the chapter;
- director-draft scenes and shots;
- the visual direction and negative prompt.

The export preserves full prose. It is not a summary-only interchange format.

## Storyboard files

The storyboard payload follows the included `iploom.production.storyboard` contract-4 shape:

```json
{
  "contract_version": 4,
  "expected_revision": 7,
  "id": "storyboard_0001",
  "episode_id": "episode_0001",
  "source_prose_version_id": "local_chapter_tide_001_r3",
  "source_prose_sha256": "<64 hex characters>",
  "title": "1. The Uncharted Tide",
  "data": {
    "medium": "stylized-3d-animation",
    "aspect_ratio": "9:16"
  },
  "scenes": []
}
```

Every scene and shot carries a positional `id` and a 1-based `sequence` generated from its position in the exported array. This avoids corrupt sequence numbers when a scene's editable ID does not end in digits. Each scene's `data.source_scene_id` and each shot's `data.source_shot_id` preserve the author's workspace IDs, so reordering or re-exporting can still match a storyboard entry back to its source. Scenes also carry `data.source_chapter_id` and `data.pov`; `story_time` is exported empty because the workspace does not model story time, and POV is never copied into it.

### Export limits and warnings

Storyboard limits are defined once in `apps/studio/src/core/storyboard-contract.ts` and shared by the writer, editor and exporter: at most 12 scenes, 20 shots per scene and 60 shots per chapter, with the same per-field character and duration ceilings used by the schemas.

Long prose is split into paragraphs before scene planning. A single newline counts as a paragraph break when a chapter has no blank-line breaks (typical Chinese manuscripts) or when paragraphs use full-width `　　` indentation; blank-line separated English prose keeps its existing layout. Paragraphs longer than 600 characters are split at `。！？` sentence endings without exceeding the per-shot limit.

Chapters whose content exceeds the limits are sampled evenly across scenes and paragraphs, and the export warns with the chapter number and the number of dropped scenes, paragraph segments or shots. Scenes are never exported with zero shots: a scene without author shots receives one draft shot. In-limit chapters are not sampled and their package content stays stable across exports.

Every shot prompt includes:

- stylized 3D animation direction;
- world, location and character continuity anchors;
- scene and shot description;
- dialogue, camera direction, aspect ratio and safe-area instruction;
- a negative prompt that rejects live action and photorealistic output.

## Approved designs

`production/approved-designs.json` collects the author-approved text designs and reusable prompts that are not tied to a single episode, such as character, costume, location and relationship specifications. It is not rendered media and is never applied automatically to storyboard shots.

```json
{
  "schema": "iploom.production-designs/v1",
  "source_workspace_revision": 7,
  "work_id": "work_tide_clock",
  "note": "Author-reviewed text specifications and reusable prompts. Not rendered media or automatically applied storyboard data.",
  "tasks": []
}
```

Each entry in `tasks` is the workflow task record: title, brief, bilingual result, scope references, pinned standard versions and model run metadata. A task is included only when all of these hold:

- its status is `done`;
- it is scoped to the exported work, or, when it has no work scope, to the exported work's universe;
- when it is pinned to a chapter, that chapter is part of the exported package; tasks without a chapter are included;
- its reviewable result contains non-empty Chinese or English text.

Pending, running and unreviewed designs are excluded. The file is listed in `manifest.json` and hashed like every other package file, so a recipient can detect edits after export.

## Visual contract

The default direction is:

```text
stylized 3D animation / 3D comic drama (3D漫), expressive characters,
cinematic staging, consistent model sheets, non-photorealistic, no live-action
```

The handoff is intentionally opinionated. This repository does not support live-action AI drama or photorealistic final video.

## Authoring boundary

Automatically split scenes and generated camera drafts are planning material. Before generation or production:

1. Verify character introduction and reveal order.
2. Check costume, prop and location continuity.
3. Review dialogue duration and subtitle safe areas.
4. Confirm every generation call and cost.
5. Validate final sound, picture and delivery assets.

Nothing in this format approves a paid generation run.

## Importing into another tool

An ArcReel-like tool can:

1. Read `manifest.json` and verify file hashes.
2. Import `world.json` as project-level IP context.
3. Map `production-structure.json` to series, season and episode records.
4. Load each episode and storyboard pair by shared sequence/episode ID.
5. Replace the matching production-scope records only after authorship approval.

The receiving tool should preserve source IDs and revision fields so a later handoff can be compared rather than silently merged.
