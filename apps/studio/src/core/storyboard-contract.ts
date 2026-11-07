import { z } from "zod";

/** Shared by the writer, editor and ArcReel export so limit checks cannot drift. */
export const STORYBOARD_LIMITS = {
  shotType: 100,
  shotDescription: 10_000,
  dialogue: 20_000,
  camera: 2_000,
  positionMs: 3_600_000,
  prompt: 20_000,
  sceneHeading: 300,
  sceneDescription: 20_000,
  location: 1_000,
  storyTime: 1_000,
  title: 200,
  shotsPerScene: 20,
  scenes: 12,
  shots: 60,
} as const;

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
    shot_type: text.max(STORYBOARD_LIMITS.shotType),
    description: text.max(STORYBOARD_LIMITS.shotDescription),
    dialogue: z.string().max(STORYBOARD_LIMITS.dialogue).default(""),
    camera: z.string().max(STORYBOARD_LIMITS.camera).default(""),
    duration_ms: z
      .number()
      .int()
      .min(1)
      .max(STORYBOARD_LIMITS.positionMs)
      .optional(),
    prompt: z.string().max(STORYBOARD_LIMITS.prompt).default(""),
    data: jsonObject,
  })
  .strict();

export const storyboardSceneSchema = z
  .object({
    id: nativeId,
    sequence,
    heading: text.max(STORYBOARD_LIMITS.sceneHeading),
    description: z.string().max(STORYBOARD_LIMITS.sceneDescription).default(""),
    location: z.string().max(STORYBOARD_LIMITS.location).default(""),
    story_time: z.string().max(STORYBOARD_LIMITS.storyTime).default(""),
    data: jsonObject,
    shots: z.array(storyboardShotSchema).max(STORYBOARD_LIMITS.shotsPerScene),
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
    title: text.max(STORYBOARD_LIMITS.title),
    data: jsonObject,
    scenes: z.array(storyboardSceneSchema).min(1).max(STORYBOARD_LIMITS.scenes),
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
    if (shots > STORYBOARD_LIMITS.shots)
      ctx.addIssue({
        code: "too_big",
        origin: "array",
        maximum: STORYBOARD_LIMITS.shots,
        inclusive: true,
        path: ["scenes"],
        message: "storyboard shot limit exceeded",
      });
  });

export type StoryboardWriteInput = z.infer<typeof storyboardWriteSchema>;
