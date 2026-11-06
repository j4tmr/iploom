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
```

The directory name includes the manifest hash prefix. Repeated exports of the same content receive a numeric suffix instead of overwriting an earlier package.

## Manifest

`manifest.json` is the integrity and provenance root:

```json
{
  "schema": "iploom.arcreel.manifest/v1",
  "generated_at": "2026-11-06T03:00:00.000Z",
  "generator": {
    "name": "IPloom Studio",
    "version": "0.3.0",
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

The `files` array records every non-manifest file with byte length and SHA-256. `manifestSha256` is computed from the serialized manifest and exposed in the app and MCP response.

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

Every scene and shot carries a 1-based sequence generated from its position in the exported array. This avoids corrupt sequence numbers when a scene's editable ID does not end in digits.

Every shot prompt includes:

- stylized 3D animation direction;
- world, location and character continuity anchors;
- scene and shot description;
- dialogue, camera direction, aspect ratio and safe-area instruction;
- a negative prompt that rejects live action and photorealistic output.

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
