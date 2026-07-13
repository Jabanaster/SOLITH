export interface PeSectionInfo {
  name: string;
  virtualSize: number;
  rawSize: number;
}

export interface TrainerExeAnalysis {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  isPe: boolean;
  machine?: string;
  peTimestamp?: string;
  subsystem?: string;
  imageBase?: string;
  entryPoint?: string;
  sections: PeSectionInfo[];
  interestingStrings: string[];
  warnings: string[];
  analyzedAt: string;
}

export interface MemoryDiffCandidate {
  id: string;
  address: string;
  dataType: string;
  baselineValue: number;
  currentValue: number;
  label: string;
  category: string;
  notes?: string;
  /** Promoted schema feature type after verification (default scan_unknown). */
  featureType?: 'scan_unknown' | 'freeze' | 'write_once';
}

export interface TrainerResearchExportBundle {
  ctXml: string;
  schemaJson: string;
  yamlDraft: string;
  title: string;
  candidateCount: number;
}
