/**
 * Offline Safety Acknowledgment — Policy v1, owner-frozen copy.
 * Single source of truth for the blocking dialog's title/body and the
 * reminder banner's short text, so the modal, the reminder, and the
 * Settings "Safety Info" view can never drift out of sync with each other.
 *
 * Changing this copy is NOT automatically a policy-version bump — see
 * SAFETY_POLICY_VERSION's doc comment in policy.ts for exactly which kinds
 * of changes require a bump.
 */
export const SAFETY_ACK_TITLE = 'Offline / Single-Player Use Only';

export const SAFETY_ACK_BODY_PARAGRAPHS: readonly string[] = [
  'SOLITH trainers are intended for offline, single-player gameplay only.',
  'Do not use SOLITH trainers in online, multiplayer, competitive, or anti-cheat-protected environments.',
  'Trainer actions can modify game memory or save data. Save or back up important progress before using trainer features.',
];

export const SAFETY_ACK_FOOTNOTE =
  "SOLITH's runtime safety protections remain active independently of this acknowledgment.";

export const SAFETY_ACK_BUTTON_LABEL = 'I Understand — Continue';

export const SAFETY_REMINDER_TITLE = 'Offline / Single-Player Only';
export const SAFETY_REMINDER_BODY =
  'SOLITH trainers are intended for offline single-player games. Runtime safety protections remain active.';
