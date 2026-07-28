import type React from 'react';

export type WalkthroughId =
  | 'game-library'
  | 'trainer-library'
  | 'ct-library'
  | 'backups'
  | 'activity-journal'
  | 'save-locations'
  | 'save-editor'
  | 'trainer-controls'
  | 'discovery-lab'
  | 'trainer-research-lab'
  | 'registry-explorer'
  | 'data-editor'
  | 'compatibility'
  | 'recipes'
  | 'session-monitor'
  | 'live-memory-trainer';

export type WalkthroughSection = {
  id: string;
  title: string;
  body: React.ReactNode;
  warning?: boolean;
  targetControlId?: string;
};

export type PageWalkthroughDefinition = {
  pageId: WalkthroughId;
  title: string;
  summary: string;
  relatedPages: string[];
  sections: WalkthroughSection[];
};

const safeImportNote = 'Solith previews metadata first. It does not execute CT scripts, attach to a process, or write memory during import.';

export const walkthroughs: Record<WalkthroughId, PageWalkthroughDefinition> = {
  'game-library': {
    pageId: 'game-library',
    title: 'How Game Library works',
    summary: 'Track local games, discover installed titles, and manage Solith-only metadata without touching game files.',
    relatedPages: ['Trainer Library', 'Save Locations', 'Save Editor'],
    sections: [
      { id: 'does', title: 'What this page does', body: 'Game Library stores your local game records: name, install path, executable, cover/icon paths, save locations, notes, and source metadata.' },
      { id: 'start', title: 'Before you start', body: 'Use Scan installed games for discovery, or Add Game Manually when a launcher is not detected. Review every preview before adding records.', targetControlId: 'game-library-add-manual' },
      { id: 'workflow', title: 'Step-by-step workflow', body: '1. Click Scan installed games or Add Game Manually. 2. Review the preview or form. 3. Select only the games you want. 4. Confirm Add selected games or Save.', targetControlId: 'game-library-add-manual' },
      { id: 'changes', title: 'What gets changed', body: 'Only Solith’s local library database changes. Removing a game entry removes Solith metadata only.' },
      { id: 'safe', title: 'What does not get changed', body: 'Solith does not modify, launch, delete, or upload game folders during library discovery.', warning: true },
      { id: 'errors', title: 'Common errors', body: 'Duplicate paths are rejected. Inaccessible launcher folders are reported in the discovery preview. Unsupported entries stay out of your library until you confirm a valid manual record.' },
    ],
  },
  'trainer-library': {
    pageId: 'trainer-library',
    title: 'How Trainer Library works',
    summary: 'Search trainer definitions, import CT/YAML metadata, and sync community listings while keeping everything gated.',
    relatedPages: ['CT Library', 'Registry Explorer', 'Live Memory Trainer'],
    sections: [
      { id: 'does', title: 'What this page does', body: 'Trainer Library shows local, verified, community, installed, running, and needs re-verification definitions.' },
      { id: 'workflow', title: 'Step-by-step workflow', body: 'Use Scan installed games for local detection, Import CT for Cheat Engine metadata, Import YAML for Solith definitions, or Sync community listings for opt-in hub metadata.', targetControlId: 'trainer-library-scan-installed' },
      { id: 'preview', title: 'Preview and confirmation', body: 'Imports and scans show previews before persistence. Declining a preview writes nothing.', targetControlId: 'trainer-library-discovery-preview' },
      { id: 'safe', title: 'Safety rules', body: 'Community entries stay L0/Scan-Required until verified. Opening a trainer deck does not execute CT scripts or write memory.', warning: true },
      { id: 'status', title: 'Status labels', body: 'Verified means Solith has local evidence. Community means metadata only. Installed means the game appears locally present. Needs re-verification means the executable/build evidence is stale.' },
    ],
  },
  'ct-library': {
    pageId: 'ct-library',
    title: 'How CT Library works',
    summary: 'Import and inspect Cheat Engine table metadata as inert research.',
    relatedPages: ['Trainer Library', 'Registry Explorer'],
    sections: [
      { id: 'metadata', title: 'What CT metadata means', body: 'CT pointers, AOB signatures, scripts, warnings, and rejections are research artifacts. They are not executable trainer controls.' },
      { id: 'zip', title: 'How to import a CT ZIP', body: '1. Click Import CT ZIP. 2. Choose a ZIP containing .CT files. 3. Review CT files, scripts, pointers, AOBs, warnings, and duplicates. 4. Confirm Import only after reviewing.', targetControlId: 'ct-library-import-zip' },
      { id: 'safe', title: 'Safety: no execution during import', body: safeImportNote, warning: true },
      { id: 'desktop', title: 'Electron desktop requirement', body: 'ZIP and CT imports require the installed Electron app because the browser cannot safely provide local filesystem paths.' },
      { id: 'trouble', title: 'Troubleshooting', body: 'If the bridge is unavailable, use the desktop app. If a ZIP is unreadable or has no CT files, Solith reports the rejection and writes nothing.' },
    ],
  },
  'activity-journal': {
    pageId: 'activity-journal',
    title: 'How Activity Journal works',
    summary: 'Review Solith’s local audit events without changing games, saves, trainers, or external applications.',
    relatedPages: ['Backups', 'Save Editor', 'Session Monitor'],
    sections: [
      { id: 'does', title: 'What this page does', body: 'Activity Journal displays the latest local Solith audit events, newest first. When a game context is active, the list is limited to that game.' },
      { id: 'recorded', title: 'What is recorded', body: 'The journal can show scan, discovery, proposal, backup, apply, rollback, error, recipe, game-added, and settings events that Solith explicitly logs. Entries may include event details when the producing workflow supplies them.' },
      { id: 'not-recorded', title: 'What is not recorded', body: 'This page is not system-wide monitoring and does not invent telemetry. Actions that do not call Solith’s journal logger do not appear here.' },
      { id: 'privacy', title: 'Storage and privacy', body: 'Journal entries are stored in Solith’s local SQLite database. The Journal page reads those local records; it does not upload them.' },
      { id: 'changes', title: 'What changes', body: 'Viewing an entry or opening its Details panel changes no journal data. This page currently exposes no clear, delete, or export control.' },
      { id: 'safe', title: 'What does not change', body: 'Journal viewing does not modify game files, save files, trainer definitions, or external applications.', warning: true },
      { id: 'states', title: 'Common states and errors', body: 'An empty journal means no matching events were returned. Some events have no Details button because no payload was stored. The page shows up to the latest 100 matching entries and has no user-facing filter control.' },
    ],
  },
  backups: {
    pageId: 'backups',
    title: 'How Backups work',
    summary: 'Inspect snapshots, restore saves, and understand rollback points.',
    relatedPages: ['Save Editor', 'Save Locations'],
    sections: [
      { id: 'does', title: 'What this page does', body: 'Backups lists snapshots created before save edits or other approved file-backed changes.' },
      { id: 'restore', title: 'Restore workflow', body: 'Select a backup, inspect its files, confirm restore, then verify the game sees the expected save state.' },
      { id: 'safe', title: 'Safety rules', body: 'Solith does not silently delete backups. Restores require confirmation and should preserve a clear rollback trail.', warning: true },
    ],
  },
  'save-locations': {
    pageId: 'save-locations',
    title: 'How Save Locations work',
    summary: 'Review detected save folders and add manual save paths.',
    relatedPages: ['Game Library', 'Save Editor', 'Backups'],
    sections: [
      { id: 'does', title: 'What this page does', body: 'Save Locations tracks where each game keeps local saves, including detected and manually added folders.' },
      { id: 'validate', title: 'Validation', body: 'Solith checks that paths exist, avoids duplicate locations, and reports permission errors rather than guessing.' },
      { id: 'remove', title: 'Safety: removal behavior', body: 'Removing a save location removes Solith metadata only. It does not delete save files.', warning: true },
    ],
  },
  'save-editor': {
    pageId: 'save-editor',
    title: 'How Save Editor works',
    summary: 'Preview, edit, back up, and roll back supported save-file fields.',
    relatedPages: ['Game Library', 'Backups', 'Save Locations'],
    sections: [
      { id: 'workflow', title: 'Step-by-step workflow', body: '1. Select a game/save. 2. Create or verify a backup. 3. Inspect supported fields. 4. Preview changes. 5. Apply only after confirmation.' },
      { id: 'changes', title: 'What gets changed', body: 'Only supported local save-file fields are changed after approval.' },
      { id: 'safe', title: 'What does not get changed', body: 'Unsupported saves, checksum mismatches, and unknown versions are blocked or require explicit review.', warning: true },
    ],
  },
  'trainer-controls': {
    pageId: 'trainer-controls',
    title: 'How Trainer Controls work',
    summary: 'Manage gated trainer controls, hotkeys, conflicts, and session-only behavior.',
    relatedPages: ['Trainer Library', 'Live Memory Trainer', 'Session Monitor'],
    sections: [
      { id: 'attach', title: 'Attach and select game', body: 'Trainer controls require an explicitly selected game/session and compatible definition status.' },
      { id: 'hotkeys', title: 'Hotkeys and conflicts', body: 'If a shortcut is already registered, Solith logs the exact failed shortcut and keeps other shortcuts available.' },
      { id: 'limits', title: 'Safety limitations', body: 'Controls do not bypass offline guards, certification gates, approval prompts, or audit rules.', warning: true },
    ],
  },
  'discovery-lab': {
    pageId: 'discovery-lab',
    title: 'How Discovery Lab works',
    summary: 'Run local discovery scans and review candidates before saving any metadata.',
    relatedPages: ['Trainer Library', 'Live Memory Trainer'],
    sections: [
      { id: 'scan', title: 'What discovery scans', body: 'Discovery scans local data sources and candidate metadata. It produces previews with false-positive warnings.' },
      { id: 'confirm', title: 'Confirmation before persistence', body: 'Preview results are not saved until you explicitly confirm the selected records.' },
      { id: 'safe', title: 'Local-only behavior', body: 'Discovery does not upload local paths or execute trainer code.', warning: true },
    ],
  },
  'trainer-research-lab': {
    pageId: 'trainer-research-lab',
    title: 'How Trainer Research Lab works',
    summary: 'Analyze trainer metadata and community research without executing it.',
    relatedPages: ['CT Library', 'Registry Explorer', 'Trainer Library'],
    sections: [
      { id: 'research', title: 'Metadata research', body: 'Use this page to compare labels, script text, signatures, and warnings as research evidence.' },
      { id: 'confidence', title: 'Confidence and warnings', body: 'Warnings and confidence labels show why Solith trusts, rejects, or quarantines a record.' },
      { id: 'safe', title: 'Safe analysis boundary', body: 'Research views do not execute scripts, attach to processes, or write memory.', warning: true },
    ],
  },
  'registry-explorer': {
    pageId: 'registry-explorer',
    title: 'How Registry Explorer works',
    summary: 'Load compiled registry JSON and inspect pointers, scripts, AOBs, warnings, and rejections read-only.',
    relatedPages: ['CT Library', 'Trainer Research Lab'],
    sections: [
      { id: 'load', title: 'Load registry', body: 'Choose a compiled Solith registry JSON file. The renderer validates schema before displaying it.', targetControlId: 'registry-explorer-load-json-file' },
      { id: 'inspect', title: 'Inspect records', body: 'Search by label, symbol, pattern, pointer, warning, or rejection. Use details to trace every record back to its source entry.' },
      { id: 'safe', title: 'Safety: read-only default', body: 'Registry Explorer does not attach to a process, execute scripts, or write memory.', warning: true },
    ],
  },
  'data-editor': {
    pageId: 'data-editor',
    title: 'How Data Editor works',
    summary: 'Preview and validate supported data-file changes with rollback expectations.',
    relatedPages: ['Save Editor', 'Backups'],
    sections: [
      { id: 'supported', title: 'Supported files', body: 'Only recognized local data formats should be edited. Unsupported files remain blocked or preview-only.' },
      { id: 'preview', title: 'Preview before apply', body: 'Schema validation and diff preview come before any apply action.' },
      { id: 'rollback', title: 'Safety: rollback behavior', body: 'Approved changes should have a backup or rollback path where the feature supports it.', warning: true },
    ],
  },
  compatibility: {
    pageId: 'compatibility',
    title: 'How Compatibility works',
    summary: 'Check whether a game/build matches Solith’s known metadata and verification status.',
    relatedPages: ['Trainer Library', 'Registry Explorer'],
    sections: [
      { id: 'checks', title: 'Compatibility checks', body: 'Solith compares game identity, launcher/build identity, executable hashes, and status labels.' },
      { id: 'status', title: 'Safety: status meanings', body: 'Unsupported, needs re-verification, L0, L2, L3, and L4 are separate states. One launcher build does not prove another.' },
      { id: 'safe', title: 'Unsupported versions', body: 'Unsupported or changed executable builds remain blocked until re-verified.', warning: true },
    ],
  },
  recipes: {
    pageId: 'recipes',
    title: 'How Recipes work',
    summary: 'Preview multi-step local changes before approving them.',
    relatedPages: ['Save Editor', 'Backups', 'Trainer Library'],
    sections: [
      { id: 'recipe', title: 'What a recipe is', body: 'A recipe is a repeatable set of local actions with permissions, preview steps, and rollback expectations.' },
      { id: 'preview', title: 'Previewing steps', body: 'Review every step and required permission before approving a recipe.' },
      { id: 'safe', title: 'Safety: trusted vs untrusted sources', body: 'Untrusted recipes require extra review and cannot silently perform dangerous actions.', warning: true },
    ],
  },
  'session-monitor': {
    pageId: 'session-monitor',
    title: 'How Session Monitor works',
    summary: 'Watch active Solith sessions, logs, status, and safe shutdown controls.',
    relatedPages: ['Trainer Controls', 'Live Memory Trainer'],
    sections: [
      { id: 'active', title: 'Active session data', body: 'Session Monitor displays current process/session status, logs, and lifecycle state.' },
      { id: 'stop', title: 'Stopping a session', body: 'Use stop controls to end a session cleanly. The monitor should surface errors instead of hiding them.' },
      { id: 'persist', title: 'Safety: what is persisted', body: 'Session status is mostly runtime evidence. Audit artifacts are separate from transient monitor logs.' },
    ],
  },
  'live-memory-trainer': {
    pageId: 'live-memory-trainer',
    title: 'How Live Memory Trainer works',
    summary: 'Explicitly select a process, run read-only discovery/verification, and keep writes behind strict gates.',
    relatedPages: ['Trainer Library', 'Session Monitor', 'Registry Explorer'],
    sections: [
      { id: 'attach', title: 'Explicit attach requirement', body: 'You must explicitly select a process. Solith does not background-attach to arbitrary games.', targetControlId: 'live-memory-process-picker' },
      { id: 'scan', title: 'Supported operations', body: 'Read-only scans, process filtering, AOB checks, and correlation watcher evidence can run before any write-capable control exists.', targetControlId: 'live-memory-auto-scan-all-types' },
      { id: 'risk', title: 'Risks and guards', body: 'No silent writes. Writes require selected game/session, offline guard, approval, certification/gating, and audit trail.', warning: true },
      { id: 'disconnect', title: 'Disconnect behavior', body: 'If the process exits, changes build, or fails verification, the session should fail closed.' },
    ],
  },
};

export const walkthroughAudit = [
  { viewId: 'library', label: 'Game Library', pageId: 'game-library', status: 'PASS' },
  { viewId: 'trainer-library', label: 'Trainer Library', pageId: 'trainer-library', status: 'PASS' },
  { viewId: 'backups', label: 'Backups', pageId: 'backups', status: 'PASS' },
  { viewId: 'locations', label: 'Save Locations', pageId: 'save-locations', status: 'PASS' },
  { viewId: 'journal', label: 'Activity Journal', pageId: 'activity-journal', status: 'PASS' },
  { viewId: 'saves', label: 'Save Editor', pageId: 'save-editor', status: 'PASS' },
  { viewId: 'controls', label: 'Trainer Controls', pageId: 'trainer-controls', status: 'PASS' },
  { viewId: 'discovery', label: 'Discovery Lab', pageId: 'discovery-lab', status: 'PASS' },
  { viewId: 'trainer-research', label: 'Trainer Research Lab', pageId: 'trainer-research-lab', status: 'PASS' },
  { viewId: 'ct-library', label: 'CT Library', pageId: 'ct-library', status: 'PASS' },
  { viewId: 'registry-explorer', label: 'Registry Explorer', pageId: 'registry-explorer', status: 'PASS' },
  { viewId: 'data', label: 'Data Editor', pageId: 'data-editor', status: 'PASS' },
  { viewId: 'compatibility', label: 'Compatibility', pageId: 'compatibility', status: 'PASS' },
  { viewId: 'recipes', label: 'Recipes', pageId: 'recipes', status: 'PASS' },
  { viewId: 'session-monitor', label: 'Session Monitor', pageId: 'session-monitor', status: 'PASS' },
  { viewId: 'live-memory', label: 'Live Memory Trainer', pageId: 'live-memory-trainer', status: 'PASS' },
] as const satisfies ReadonlyArray<{
  viewId: string;
  label: string;
  pageId: WalkthroughId;
  status: 'PASS' | 'PARTIAL' | 'MISSING' | 'N/A';
}>;

export const requiredWalkthroughIds: WalkthroughId[] = walkthroughAudit.map(({ pageId }) => pageId);

export function getWalkthrough(pageId: WalkthroughId): PageWalkthroughDefinition {
  const walkthrough = walkthroughs[pageId];
  if (!walkthrough) {
    throw new Error(`Missing Solith walkthrough content for ${pageId}`);
  }
  return walkthrough;
}
