import { createId, displayText } from "../core/factory.ts";
import type {
  Chapter,
  Character,
  StoryLocation,
  UiLocale,
} from "../core/types.ts";
import { formatNumber, type Translate } from "../i18n.ts";
import { Button, Field, Select, TextArea, TextInput } from "./ui.tsx";

export function SceneEditor({
  chapter,
  characters,
  locations,
  locale,
  t,
  onChange,
}: {
  chapter: Chapter;
  characters: Character[];
  locations: StoryLocation[];
  locale: UiLocale;
  t: Translate;
  onChange: (change: (chapter: Chapter) => void) => void;
}) {
  return (
    <section className="settings-panel">
      <h3>{t("scenesTitle")}</h3>
      <p>{t("scenesLead")}</p>
      {chapter.scenes.map((scene, sceneIndex) => (
        <details key={scene.id}>
          <summary>
            {sceneIndex + 1}. {scene.title} ·{" "}
            {t("scenesShots", {
              count: formatNumber(scene.shots.length, locale),
            })}
          </summary>
          <Field label={t("sceneTitleField")}>
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
          <Field label={t("sceneSummaryField")}>
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
          <Field label={t("sceneLocationField")}>
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
          <Field label={t("sceneCastField")}>
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
                {t("sceneShot")} {shotIndex + 1} · {shot.shotType} ·{" "}
                {shot.durationMs / 1000}s
              </summary>
              {(
                [
                  ["shotType", t("shotFraming"), 100],
                  ["description", t("shotAction"), 20_000],
                  ["camera", t("shotCamera"), 2000],
                  ["dialogue", t("shotDialogue"), 20_000],
                  ["visualPrompt", t("shotVisualPrompt"), 20_000],
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
              <Field label={t("shotDuration")}>
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
                  if (window.confirm(t("shotDeleteConfirm")))
                    onChange((draft) => {
                      draft.scenes[sceneIndex]!.shots.splice(shotIndex, 1);
                    });
                }}
              >
                {t("shotDelete")}
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
              {t("shotAdd")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(t("sceneDeleteConfirm")))
                  onChange((draft) => {
                    draft.scenes.splice(sceneIndex, 1);
                  });
              }}
            >
              {t("sceneDelete")}
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
              title: t("sceneNew"),
              summary: "",
              characterIds: [...draft.characterIds],
              locationId: draft.locationId,
              shots: [],
            });
          })
        }
      >
        {t("sceneAdd")}
      </Button>
    </section>
  );
}
