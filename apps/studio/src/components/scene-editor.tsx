import { createId, displayText } from "../core/factory.ts";
import type {
  Chapter,
  Character,
  StoryLocation,
  UiLocale,
} from "../core/types.ts";
import { Button, Field, Select, TextArea, TextInput } from "./ui.tsx";

export function SceneEditor({
  chapter,
  characters,
  locations,
  locale,
  onChange,
}: {
  chapter: Chapter;
  characters: Character[];
  locations: StoryLocation[];
  locale: UiLocale;
  onChange: (change: (chapter: Chapter) => void) => void;
}) {
  const en = locale === "en";
  return (
    <section className="settings-panel">
      <h3>{en ? "Scenes and production shots" : "场景与制作镜头"}</h3>
      <p>
        {en
          ? "Keep scene locations, cast and shot prompts with the chapter. AI drafts can be reviewed in the production desk before applying edits here."
          : "为章节维护场景地点、出场人物与镜头提示词。AI 草案先在制作台审阅，再将确认的设计填入这里。"}
      </p>
      {chapter.scenes.map((scene, sceneIndex) => (
        <details key={scene.id}>
          <summary>
            {sceneIndex + 1}. {scene.title} · {scene.shots.length}{" "}
            {en ? "shots" : "镜头"}
          </summary>
          <Field label={en ? "Scene title" : "场景标题"}>
            <TextInput
              maxLength={300}
              value={scene.title}
              onChange={(e) =>
                onChange((draft) => {
                  draft.scenes[sceneIndex]!.title = e.target.value;
                })
              }
            />
          </Field>
          <Field
            label={
              en ? "Action, time and source evidence" : "行动、时间与原文依据"
            }
          >
            <TextArea
              rows={4}
              maxLength={20_000}
              value={scene.summary}
              onChange={(e) =>
                onChange((draft) => {
                  draft.scenes[sceneIndex]!.summary = e.target.value;
                })
              }
            />
          </Field>
          <Field label={en ? "Location" : "地点"}>
            <Select
              value={scene.locationId ?? ""}
              onChange={(e) =>
                onChange((draft) => {
                  draft.scenes[sceneIndex]!.locationId =
                    e.target.value || undefined;
                })
              }
            >
              <option value="">—</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {displayText(location.name, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={en ? "Cast" : "出场人物"}>
            <div className="cast-check-list">
              {characters.map((character) => (
                <label key={character.id}>
                  <input
                    type="checkbox"
                    checked={scene.characterIds.includes(character.id)}
                    onChange={(e) =>
                      onChange((draft) => {
                        const target = draft.scenes[sceneIndex]!;
                        target.characterIds = e.target.checked
                          ? [...target.characterIds, character.id]
                          : target.characterIds.filter(
                              (id) => id !== character.id,
                            );
                      })
                    }
                  />
                  {displayText(character.name, locale)}
                </label>
              ))}
            </div>
          </Field>
          {scene.shots.map((shot, shotIndex) => (
            <details key={shot.id}>
              <summary>
                {en ? "Shot" : "镜头"} {shotIndex + 1} · {shot.shotType} ·{" "}
                {shot.durationMs / 1000}s
              </summary>
              {(
                [
                  ["shotType", en ? "Framing" : "景别", 100],
                  [
                    "description",
                    en ? "Action / staging" : "动作 / 调度",
                    20_000,
                  ],
                  ["camera", en ? "Camera / motion" : "摄影 / 运镜", 2000],
                  ["dialogue", en ? "Dialogue / audio" : "对白 / 声音", 20_000],
                  [
                    "visualPrompt",
                    en
                      ? "Image / video production prompt"
                      : "图像 / 视频制作提示词",
                    20_000,
                  ],
                ] as const
              ).map(([key, label, max]) => (
                <Field key={key} label={label}>
                  <TextArea
                    rows={key === "visualPrompt" ? 4 : 2}
                    maxLength={max}
                    value={shot[key]}
                    onChange={(e) =>
                      onChange((draft) => {
                        draft.scenes[sceneIndex]!.shots[shotIndex]![key] =
                          e.target.value;
                      })
                    }
                  />
                </Field>
              ))}
              <Field label={en ? "Duration (milliseconds)" : "时长（毫秒）"}>
                <TextInput
                  type="number"
                  min={400}
                  max={120000}
                  step={100}
                  value={shot.durationMs}
                  onChange={(e) =>
                    onChange((draft) => {
                      draft.scenes[sceneIndex]!.shots[shotIndex]!.durationMs =
                        Math.max(
                          400,
                          Math.min(
                            120000,
                            Math.round(Number(e.target.value) || 400),
                          ),
                        );
                    })
                  }
                />
              </Field>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(en ? "Delete this shot?" : "删除此镜头？"))
                    onChange((draft) => {
                      draft.scenes[sceneIndex]!.shots.splice(shotIndex, 1);
                    });
                }}
              >
                {en ? "Delete shot" : "删除镜头"}
              </Button>
            </details>
          ))}
          <div className="production-actions">
            <Button
              disabled={scene.shots.length >= 80}
              onClick={() =>
                onChange((draft) => {
                  draft.scenes[sceneIndex]!.shots.push({
                    id: createId("shot"),
                    shotType: "medium",
                    description: "",
                    dialogue: "",
                    camera: "",
                    durationMs: 3000,
                    visualPrompt:
                      "stylized 3D animation, non-photorealistic; maintain character identity and costume continuity",
                  });
                })
              }
            >
              {en ? "Add shot" : "添加镜头"}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    en
                      ? "Delete this scene and its shots?"
                      : "删除此场景及镜头？",
                  )
                )
                  onChange((draft) => {
                    draft.scenes.splice(sceneIndex, 1);
                  });
              }}
            >
              {en ? "Delete scene" : "删除场景"}
            </Button>
          </div>
        </details>
      ))}
      <Button
        disabled={chapter.scenes.length >= 100}
        onClick={() =>
          onChange((draft) => {
            draft.scenes.push({
              id: createId("scene"),
              title: en ? "New scene" : "新场景",
              summary: "",
              characterIds: [...draft.characterIds],
              locationId: draft.locationId,
              shots: [],
            });
          })
        }
      >
        {en ? "Add scene" : "添加场景"}
      </Button>
    </section>
  );
}
