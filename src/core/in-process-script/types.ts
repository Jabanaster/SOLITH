import type { AaScriptAnalysis } from '../script-research/types.js';

export type HookPresetId = 'crimson-fast-friendship';

export interface HookInstallPlan {
  presetId?: HookPresetId;
  cheatName: string;
  executable: string;
  moduleName: string;
  aobSignature: string;
  symbol?: string;
  patchByteCount: number;
  executablePlan: boolean;
  status: 'ready' | 'plan_only' | 'missing_aob';
  warnings: string[];
  notes: string[];
  sourceAnalysis?: Pick<AaScriptAnalysis, 'replicationStrategy' | 'usesCodeInjection' | 'memoryOperandHints'>;
}

export interface HookInstallManifest {
  manifestId: string;
  presetId: HookPresetId;
  hookSite: string;
  caveAddress: string;
  originalBytesHex: string;
  installedAt: string;
}

export interface HookInstallProposal {
  proposalId: string;
  plan: HookInstallPlan;
  createdAt: string;
}

export interface InjectorLaunchProposal {
  proposalId: string;
  exePath: string;
  fileName: string;
  sha256?: string;
  warnings: string[];
  createdAt: string;
}

export interface InProcessGateInput {
  featureEnabled: boolean;
  userConfirmedOffline: boolean;
  userApprovedAction: boolean;
  executableName: string;
}
