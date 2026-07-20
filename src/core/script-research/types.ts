export interface AobScanExtract {
  symbol: string;
  module: string;
  patternRaw: string;
  /** Normalized for Solith `parseAobSignature` (`?` wildcards). */
  patternSolith: string;
  rawAobComment?: string;
}

export interface AaScriptAnalysis {
  cheatName: string;
  scriptBytes: number;
  aobScans: AobScanExtract[];
  registeredSymbols: string[];
  allocLabels: string[];
  usesCodeInjection: boolean;
  injectionHints: string[];
  memoryOperandHints: Array<{ register: string; offset: number; size: number; operation: string }>;
  replicationStrategy: ScriptReplicationStrategy;
  workflowSteps: string[];
}

export type ScriptReplicationStrategy =
  | 'memory_diff'
  | 'pointer_scan_symbol'
  | 'aob_signature_locate'
  | 'ue_dumpspace_member'
  | 'mixed';

export interface CtScriptResearchReport {
  title: string;
  catalogGameId: string;
  executable: string;
  analyzedScripts: number;
  scripts: AaScriptAnalysis[];
  allSymbols: string[];
  notes: string[];
}

export type CtRawScriptType = 'AutoAssembler_Script' | 'Lua_Script' | 'CheatScript_Metadata';

export interface CtRawScriptCatalogEntry {
  ctId?: string;
  name: string;
  path: string;
  type: CtRawScriptType;
  script_excerpt: string;
  raw_script_content: string;
  executable: false;
}

export interface CtRawScriptCatalog {
  title: string;
  catalogGameId: string;
  sourceNote: string;
  scripts: CtRawScriptCatalogEntry[];
}

export type AobScanType = 'aobscan' | 'aobscanmodule' | 'aobscanregion';

export type AobCompleteness = 'complete' | 'partial' | 'invalid';

export interface ExtractedAobSignature {
  symbol: string;
  module?: string;
  pattern: string;
  rawPattern: string;
  scanType: AobScanType;
  sourceEntry: string;
  sourcePath: string;
  sourceScriptType: CtRawScriptType;
  lineNumber: number;
  executable: false;
  nearbyLabels: string[];
  nearbyOffsets: string[];
  registeredSymbols: string[];
  warnings: string[];
  completeness: AobCompleteness;
  duplicateOf?: string;
}

export interface AobSignatureExtractionReport {
  sourceTitle: string;
  extractedAt: string;
  totalScripts: number;
  totalSignatures: number;
  duplicateSignatures: number;
  signatures: ExtractedAobSignature[];
  warnings: string[];
}

export interface MergedUeScriptHint {
  cheatName: string;
  scriptStrategy: ScriptReplicationStrategy;
  ueClassMember?: string;
  ueOffset?: number;
  ueTypeLabel?: string;
  workflowSteps: string[];
}

export const SCRIPT_RESEARCH_CHARTER = {
  authorized: [
    'Extract AOB patterns and registered symbols from AssemblerScript',
    'Read-only AOB scan in attached game process (no hook/write)',
    'CE runs scripts externally → Research Lab memory diff → import pointers',
    'Pointer-scan from diff results to build freeze/write_once schema.v1 features',
    'Import UEDumper Dumpspace JSON for UE struct member hints',
  ],
  notAuthorized: [
    'Auto-convert AssemblerScript to executable in-process hooks',
    'Code-cave emulation or injection from Solith',
    'Launching third-party trainer/injector binaries',
  ],
} as const;
