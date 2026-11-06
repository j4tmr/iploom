import { z } from "zod";

const nativeId = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/, "invalid native id");
const revision = z.number().int().nonnegative();
const sequence = z.number().int().min(1).max(100_000);
const text = z.string().trim().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const jsonObject = z.record(z.string(), z.json()).default({});

export const storyboardShotSchema = z
  .object({
    id: nativeId,
    sequence,
    shot_type: text.max(100),
    description: text.max(10_000),
    dialogue: z.string().max(20_000).default(""),
    camera: z.string().max(2_000).default(""),
    duration_ms: z.number().int().min(1).max(3_600_000).optional(),
    prompt: z.string().max(20_000).default(""),
    data: jsonObject,
  })
  .strict();

export const storyboardSceneSchema = z
  .object({
    id: nativeId,
    sequence,
    heading: text.max(300),
    description: z.string().max(20_000).default(""),
    location: z.string().max(1_000).default(""),
    story_time: z.string().max(1_000).default(""),
    data: jsonObject,
    shots: z.array(storyboardShotSchema).max(20),
  })
  .strict();

export const storyboardWriteSchema = z
  .object({
    contract_version: z.literal(4),
    expected_revision: revision,
    id: nativeId,
    episode_id: nativeId,
    source_prose_version_id: nativeId,
    source_prose_sha256: sha256,
    source_script_version_id: nativeId.optional(),
    source_script_sha256: sha256.optional(),
    based_on_storyboard_version_id: nativeId.optional(),
    title: text.max(200),
    data: jsonObject,
    scenes: z.array(storyboardSceneSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!!value.source_script_version_id !== !!value.source_script_sha256)
      ctx.addIssue({
        code: "custom",
        path: ["source_script_sha256"],
        message: "script version and sha must be supplied together",
      });
    const sceneIds = new Set<string>();
    const sceneSequences = new Set<number>();
    let shots = 0;
    for (const [sceneIndex, scene] of value.scenes.entries()) {
      if (sceneIds.has(scene.id) || sceneSequences.has(scene.sequence))
        ctx.addIssue({
          code: "custom",
          path: ["scenes", sceneIndex],
          message: "duplicate scene identity or sequence",
        });
      sceneIds.add(scene.id);
      sceneSequences.add(scene.sequence);
      const shotIds = new Set<string>();
      const shotSequences = new Set<number>();
      shots += scene.shots.length;
      for (const [shotIndex, shot] of scene.shots.entries()) {
        if (shotIds.has(shot.id) || shotSequences.has(shot.sequence))
          ctx.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "shots", shotIndex],
            message: "duplicate shot identity or sequence",
          });
        shotIds.add(shot.id);
        shotSequences.add(shot.sequence);
      }
    }
    if (shots > 60)
      ctx.addIssue({
        code: "too_big",
        origin: "array",
        maximum: 60,
        inclusive: true,
        path: ["scenes"],
        message: "storyboard shot limit exceeded",
      });
  });

export type StoryboardWriteInput = z.infer<typeof storyboardWriteSchema>;
