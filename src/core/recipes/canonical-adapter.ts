import type { Recipe } from '../../shared/types/index.js';
import type { SaveFieldFeatureV1 } from '../definitions/schema.v1.js';

/**
 * Recipe -> canonical SaveFieldFeatureV1 adapter (P4-4 §9/§15/§16).
 *
 * Recipe is a real, independently-persisted, independently-executed legacy
 * definition authority (see Docs/phase4 P4-4 evidence doc, "Recipe /
 * TrainerItem" section) that overlaps semantically with schema.v1's
 * `SaveFieldFeatureV1` for the narrow case it actually models: a named field
 * at a resolvable path inside a save file. This module is the explicit,
 * one-way "Legacy Format -> Adapter -> Canonical Trainer Definition" bridge
 * the mission requires (§2) — it does not persist anything itself and does
 * not change how `Recipe` rows are created, read, or executed today
 * (`src/core/recipes/index.ts`, `src/core/saves/editor.ts` are untouched).
 *
 * Classification: LOSSY_WITH_WARNING (mission §16) — `SaveFieldFeatureV1` has
 * no equivalent for the majority of `Recipe`'s authoring/execution metadata
 * (risk model, backup requirement, confidence, input constraints, validation
 * rules, adapter targeting strategy). Every field that cannot be represented
 * is reported in `losses`, never silently dropped.
 */

export interface RecipeAdapterResult {
  success: true;
  feature: SaveFieldFeatureV1;
  warnings: string[];
  losses: string[];
  source: 'recipe';
}

export interface RecipeAdapterFailure {
  success: false;
  reason: string;
  losses: string[];
  source: 'recipe';
}

const CANONICAL_FIELDS = new Set(['id', 'name', 'gameId', 'category', 'valueType', 'path']);

function lossesFor(recipe: Recipe): string[] {
  const losses: string[] = [];
  for (const [key, value] of Object.entries(recipe)) {
    if (CANONICAL_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;
    losses.push(key);
  }
  return losses;
}

/**
 * Converts a single Recipe row into a canonical `SaveFieldFeatureV1`. Never
 * throws — a Recipe with no usable field path fails closed with a typed
 * reason rather than fabricating a mapping.
 */
export function recipeToSaveFieldFeature(recipe: Recipe): RecipeAdapterResult | RecipeAdapterFailure {
  const losses = lossesFor(recipe);

  if (!recipe.path || !recipe.path.trim()) {
    return { success: false, reason: 'recipe_has_no_field_path', losses, source: 'recipe' };
  }
  if (!recipe.id || !recipe.name) {
    return { success: false, reason: 'recipe_missing_id_or_name', losses, source: 'recipe' };
  }

  const warnings: string[] = [];
  if (recipe.needsRescan) {
    warnings.push('recipe was flagged needsRescan — the mapped path may be stale for the current save format');
  }
  if (recipe.isActive === false) {
    warnings.push('recipe is inactive — mapped feature is a point-in-time snapshot, not a live-synced definition');
  }

  const feature: SaveFieldFeatureV1 = {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category || 'Uncategorized',
    dataType: recipe.valueType || 'string',
    mapping: { searchKey: recipe.path },
  };

  return { success: true, feature, warnings, losses, source: 'recipe' };
}

/**
 * Batch form for converting every Recipe for a game — the shape a future
 * "promote recipes to a trainer definition" IPC action would consume.
 * Partial failures are collected per-recipe, never abort the whole batch
 * (mission §23 pattern, applied here to recipe conversion).
 */
export function recipesToSaveFieldFeatures(
  recipes: Recipe[],
): { features: SaveFieldFeatureV1[]; failures: Array<{ recipeId: string; reason: string }>; warnings: string[]; losses: Record<string, string[]> } {
  const features: SaveFieldFeatureV1[] = [];
  const failures: Array<{ recipeId: string; reason: string }> = [];
  const warnings: string[] = [];
  const losses: Record<string, string[]> = {};

  for (const recipe of recipes) {
    const result = recipeToSaveFieldFeature(recipe);
    losses[recipe.id] = result.losses;
    if (result.success === false) {
      failures.push({ recipeId: recipe.id, reason: result.reason });
      continue;
    }
    features.push(result.feature);
    warnings.push(...result.warnings.map((w) => `${recipe.id}: ${w}`));
  }

  return { features, failures, warnings, losses };
}
