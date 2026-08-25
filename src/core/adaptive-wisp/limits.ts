/**
 * Adaptive Wisp resource limits (Increment 1, Section 11).
 *
 * A community/creator profile is untrusted input parsed before any UI ever
 * sees it. Every bound below exists so a malformed or hostile profile can be
 * rejected cheaply instead of causing UI-side or parser-side resource
 * exhaustion. Centralized here — never scattered as inline magic numbers in
 * schema.ts or validation.ts.
 */
export const WISP_PROFILE_LIMITS = {
  /** Rejects a raw payload before it is even parsed — see validation.ts's size check. */
  maxSerializedProfileBytes: 65536,
  maxGroups: 20,
  maxActions: 64,
  maxActionsPerGroup: 32,
  maxPresetsPerAction: 12,
  /** General label/name field ceiling (mirrors trainer-catalog's displayName bound). */
  maxStringLength: 200,
  /** shortLabel is meant to be genuinely short ("HP", "XP") — not a second label field. */
  maxShortLabelLength: 24,
  maxDescriptionLength: 500,
  /** profileId / actionId / groupId / entryId / gameId / trainerId / tableId. */
  maxIdLength: 120,
  maxHotkeyLength: 40,
  maxTimestampLength: 40,
  minQuickSlot: 1,
  maxQuickSlot: 6,
  minPriority: 0,
  maxPriority: 1000,

  /** Increment 2 — user override arrays/maps are bounded by the same domain size a profile itself is bounded by. */
  maxOverrideGroupOrderEntries: 20,
  maxOverrideActionOrderGroups: 20,
  maxOverrideActionsPerGroupOrder: 32,
  maxOverrideHiddenActions: 64,
  maxOverrideSlotAssignments: 64,
  maxOverrideActionGroupOverrides: 64,

  /** Increment 2 — bounded persisted-file size, checked before JSON.parse. */
  maxPersistedFileBytes: 131072,
} as const;
