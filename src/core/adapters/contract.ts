import { ParsedDocument } from '../../shared/types';

export interface ReadValueResult {
  value: any;
  success: boolean;
  error?: string;
  /** Set when the adapter discarded non-data content (e.g. comments) while reading; never silent. */
  warnings?: string[];
}

export interface DryRunResult {
  success: boolean;
  error?: string;
}

export interface BuildOutputResult {
  content: string;
  success: boolean;
  error?: string;
  /** Set when the written content dropped non-data content (e.g. comments) present in the source file; never silent. */
  warnings?: string[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface TrainerAdapter {
  readonly id: string;
  readonly version: string;

  supports(filePath: string): boolean;
  readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult>;
  dryRun(filePath: string, pathStr: string, expectedOldValue?: any): Promise<DryRunResult>;
  buildOutput(filePath: string, pathStr: string, newValue: any): Promise<BuildOutputResult>;
  validateContent(content: string, filePath: string): Promise<ValidationResult>;
  parseAndNormalize(filePath: string): Promise<ParsedDocument>;
}
