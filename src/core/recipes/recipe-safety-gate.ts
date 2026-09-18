import { getRecipeById, validateRecipeSafety } from './index.js';

/**
 * P4-13 (mission §14): recipe-safety gating for the save-edit proposal flow,
 * moved OUT of `src/core/saves/editor.ts` so that module can be pure
 * file-edit mechanics (path/value/backup/atomic-write) with no knowledge of
 * `Recipe` as a concept — editor.ts is a save-backend, not a second trainer-
 * definition authority (mission §13/§16: Recipe may remain an import/
 * authoring compatibility shape, but must not remain embedded as live
 * execution authority inside the backend it shares with every other
 * save-edit path).
 *
 * Callers (electron/main.ts's `create-proposal-for-edit`/`apply-proposal`
 * IPC handlers) run this BEFORE invoking editor.ts — the exact same check,
 * at the exact same two points in the flow, just one layer higher. A
 * `recipeId` that fails this check never reaches editor.ts at all, same as
 * before.
 */
export function assertRecipeSafeForProposal(recipeId: string | null | undefined): void {
  if (!recipeId) return;
  const recipe = getRecipeById(recipeId);
  if (!recipe) {
    throw new Error(`Recipe with ID "${recipeId}" not found.`);
  }
  const safety = validateRecipeSafety(recipe);
  if (!safety.valid) {
    throw new Error(`Recipe safety violation: ${safety.error}`);
  }
}
