import { issue, type WispProfileValidationIssue } from './errors.js';
import { WISP_PROFILE_LIMITS } from './limits.js';
import { migrateWispProfileToCurrentVersion } from './migrations.js';
import { WISP_PROFILE_SCHEMA_VERSION, WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS, WispGameProfileSchema } from './schema.js';
import { scanForExecutableMetadata } from './security-scan.js';
import type { WispGameProfile } from './types.js';

/**
 * Adaptive Wisp profile validation pipeline (Increment 1, Sections 12-14).
 *
 * raw input -> blocklist scan -> size check -> version check -> migration
 * -> schema parse -> cross-reference validation -> normalized WispGameProfile
 *
 * Nothing here touches a live session, a trainer entry, or a memory service —
 * this is pure data validation. Runtime binding is a later increment.
 */

export type WispProfileValidation = { ok: true; profile: WispGameProfile } | { ok: false; issues: WispProfileValidationIssue[] };

function byteLength(raw: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return Infinity;
  }
}

function extractSchemaVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as Record<string, unknown>).schemaVersion;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function validateWispGameProfile(raw: unknown): WispProfileValidation {
  const blocked = scanForExecutableMetadata(raw, 'profile');
  if (blocked) return { ok: false, issues: [blocked] };

  if (byteLength(raw) > WISP_PROFILE_LIMITS.maxSerializedProfileBytes) {
    return { ok: false, issues: [issue('WISP_PROFILE_TOO_LARGE', `serialized profile exceeds ${WISP_PROFILE_LIMITS.maxSerializedProfileBytes} bytes`)] };
  }

  const version = extractSchemaVersion(raw);
  if (version === null || !WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS.includes(version)) {
    return {
      ok: false,
      issues: [issue('WISP_PROFILE_VERSION_UNSUPPORTED', `schemaVersion ${version === null ? '(missing/malformed)' : version} is not supported (supported: ${WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS.join(', ')})`, 'schemaVersion')],
    };
  }

  const migrated = migrateWispProfileToCurrentVersion(raw as Record<string, unknown>, version);

  const parsed = WispGameProfileSchema.safeParse(migrated);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      issues: [issue('WISP_PROFILE_SCHEMA_INVALID', first?.message ?? 'schema validation failed', first?.path.join('.'))],
    };
  }

  const profile = parsed.data as WispGameProfile;
  const crossRefIssues = validateCrossReferences(profile);
  if (crossRefIssues.length > 0) {
    return { ok: false, issues: crossRefIssues };
  }

  return { ok: true, profile };
}

function validateCrossReferences(profile: WispGameProfile): WispProfileValidationIssue[] {
  const issues: WispProfileValidationIssue[] = [];

  if (profile.actions.length > WISP_PROFILE_LIMITS.maxActions) {
    issues.push(issue('WISP_PROFILE_TOO_MANY_ACTIONS', `profile has ${profile.actions.length} actions, limit is ${WISP_PROFILE_LIMITS.maxActions}`, 'actions'));
  }
  if (profile.groups.length > WISP_PROFILE_LIMITS.maxGroups) {
    issues.push(issue('WISP_PROFILE_TOO_MANY_ACTIONS', `profile has ${profile.groups.length} groups, limit is ${WISP_PROFILE_LIMITS.maxGroups}`, 'groups'));
  }

  const actionIds = new Set<string>();
  for (let i = 0; i < profile.actions.length; i++) {
    const action = profile.actions[i];
    if (actionIds.has(action.id)) {
      issues.push(issue('WISP_PROFILE_DUPLICATE_ACTION_ID', `duplicate action id "${action.id}"`, `actions[${i}].id`));
    }
    actionIds.add(action.id);

    if (action.slot !== undefined && (action.slot < WISP_PROFILE_LIMITS.minQuickSlot || action.slot > WISP_PROFILE_LIMITS.maxQuickSlot)) {
      issues.push(issue('WISP_PROFILE_INVALID_SLOT', `slot ${action.slot} is outside [${WISP_PROFILE_LIMITS.minQuickSlot}, ${WISP_PROFILE_LIMITS.maxQuickSlot}]`, `actions[${i}].slot`));
    }
    if (action.priority !== undefined && (action.priority < WISP_PROFILE_LIMITS.minPriority || action.priority > WISP_PROFILE_LIMITS.maxPriority)) {
      issues.push(issue('WISP_PROFILE_INVALID_SLOT', `priority ${action.priority} is outside [${WISP_PROFILE_LIMITS.minPriority}, ${WISP_PROFILE_LIMITS.maxPriority}]`, `actions[${i}].priority`));
    }
  }

  const groupIds = new Set<string>();
  for (let i = 0; i < profile.groups.length; i++) {
    const group = profile.groups[i];
    if (groupIds.has(group.id)) {
      issues.push(issue('WISP_PROFILE_DUPLICATE_GROUP_ID', `duplicate group id "${group.id}"`, `groups[${i}].id`));
    }
    groupIds.add(group.id);

    if (group.actionIds.length > WISP_PROFILE_LIMITS.maxActionsPerGroup) {
      issues.push(issue('WISP_PROFILE_TOO_MANY_ACTIONS_IN_GROUP', `group "${group.id}" has ${group.actionIds.length} action references, limit is ${WISP_PROFILE_LIMITS.maxActionsPerGroup}`, `groups[${i}].actionIds`));
    }

    const seenInGroup = new Set<string>();
    for (let j = 0; j < group.actionIds.length; j++) {
      const refId = group.actionIds[j];
      if (seenInGroup.has(refId)) {
        issues.push(issue('WISP_PROFILE_DUPLICATE_ACTION_ID', `group "${group.id}" references action "${refId}" more than once`, `groups[${i}].actionIds[${j}]`));
      }
      seenInGroup.add(refId);
      if (!actionIds.has(refId)) {
        issues.push(issue('WISP_PROFILE_UNKNOWN_ACTION_REFERENCE', `group "${group.id}" references unknown action "${refId}"`, `groups[${i}].actionIds[${j}]`));
      }
    }
  }

  for (let i = 0; i < profile.actions.length; i++) {
    const action = profile.actions[i];
    if (action.groupId !== undefined && !groupIds.has(action.groupId)) {
      issues.push(issue('WISP_PROFILE_UNKNOWN_GROUP_REFERENCE', `action "${action.id}" references unknown group "${action.groupId}"`, `actions[${i}].groupId`));
    }
  }

  return issues;
}

export { WISP_PROFILE_SCHEMA_VERSION };
