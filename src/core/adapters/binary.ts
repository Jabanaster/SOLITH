import fs from 'fs';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { extractStringsFromBinary } from '../saves/index';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

export class BinaryAdapter implements TrainerAdapter {
  readonly id = 'binary-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    const lowerName = filePath.toLowerCase();
    if (lowerName.endsWith('.sav') || lowerName.endsWith('.dat') || lowerName.endsWith('.bin')) {
      return true;
    }
    try {
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        return buffer.slice(0, 1024).includes(0x00);
      }
    } catch {}
    return false;
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const buffer = fs.readFileSync(filePath);
      if (pathStr === 'meta.hash') {
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        return { success: true, value: hash };
      }
      if (pathStr === 'meta.size') {
        return { success: true, value: buffer.length };
      }
      if (pathStr === 'meta.magicBytes') {
        return { success: true, value: buffer.slice(0, 4).toString('hex').toUpperCase() };
      }
      
      const match = pathStr.match(/strings\[(\d+)\]/);
      if (!match) {
        return { success: false, value: null, error: 'Unsupported binary save path' };
      }
      const idx = parseInt(match[1]);
      const extracted = extractStringsFromBinary(buffer);
      if (idx >= extracted.length) {
        return { success: false, value: null, error: 'Binary string index out of bounds' };
      }
      return { success: true, value: extracted[idx] };
    } catch (e) {
      return { success: false, value: null, error: String(e) };
    }
  }

  async dryRun(filePath: string, pathStr: string, expectedOldValue?: any): Promise<DryRunResult> {
    try {
      const res = await this.readCurrentValue(filePath, pathStr);
      if (!res.success) return { success: false, error: res.error };
      if (expectedOldValue !== undefined && String(res.value) !== String(expectedOldValue)) {
        return { success: false, error: 'Value mismatch' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async buildOutput(filePath: string, pathStr: string, newValue: any): Promise<BuildOutputResult> {
    return { success: false, content: '', error: 'Binary save modification is unsupported in Solith V1.' };
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    return { valid: false, error: 'Binary validation is unsupported' };
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath);
    const diagnostics: ParserDiagnostic[] = [];
    
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const magicBytes = raw.slice(0, 4).toString('hex').toUpperCase();
    
    // Extract strings and cap to prevent performance blocking
    const extracted = extractStringsFromBinary(raw).slice(0, 500);
    
    const rootData = {
      size: raw.length,
      hash,
      magicBytes,
      strings: extracted
    };
    
    // Binary files are marked read-only (editable = false)
    return buildParsedDocument(this.id, this.version, filePath, 'binary', rootData, diagnostics, false);
  }
}
