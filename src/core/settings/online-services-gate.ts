/**
 * Master "Online Services" gate.
 *
 * This is the single place every network-calling module should consult
 * before making an outbound request. When `onlineServicesEnabled` is false,
 * every online feature is blocked unconditionally — no per-feature flag can
 * override that. When `onlineServicesEnabled` is true, this function only
 * confirms the master switch is on; callers must still check their own
 * per-feature flag (e.g. `communitySyncEnabled`) on top of this, since ON is
 * necessary-but-not-sufficient for any individual online feature.
 *
 * Local-only functionality (Discovery index, local trainers, trainer
 * creation, My Games, install discovery, backups) does not call this gate at
 * all — it must keep working regardless of this setting.
 */

export type OnlineServiceFeature =
  | 'community-sync'
  | 'catalog-refresh'
  | 'trainer-download'
  | 'trainer-upload'
  | 'provider-account-sync'
  | 'artwork-download';

export interface OnlineServicesGateSettings {
  onlineServicesEnabled: boolean;
}

/**
 * Returns whether a given online feature is currently allowed to make a
 * network call. Returns `false` unconditionally when the master
 * `onlineServicesEnabled` switch is off, regardless of the feature or any
 * per-feature flag the caller may separately track.
 */
export function isOnlineOperationAllowed(
  settings: OnlineServicesGateSettings,
  feature: OnlineServiceFeature,
): boolean {
  if (settings.onlineServicesEnabled === false) {
    return false;
  }

  // Master switch is on. This gate does not know about (and must not
  // encode) any individual feature's own opt-in flag — the caller is
  // responsible for checking that separately. `feature` is accepted so call
  // sites are self-documenting and so future feature-specific master-level
  // exceptions have a single place to live, but it is otherwise unused today.
  void feature;

  return true;
}
