import type { AiSkill } from "../skills.ts";
import { worldFoundationSkill } from "./world-foundation.ts";

/**
 * Every application-level skill the studio can run. Adding one is a code change
 * here plus its own module; the run state machine and any UI work off this list.
 */
export const AI_SKILLS: readonly AiSkill[] = [worldFoundationSkill];

export function findAiSkill(id: string): AiSkill | undefined {
  return AI_SKILLS.find((skill) => skill.id === id);
}

export { worldFoundationSkill };
