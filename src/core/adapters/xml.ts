import fs from 'fs';
import xml2js from 'xml2js';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { getDeepValue, setDeepValue } from './json';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

export function validateXmlSafety(content: string): { safe: boolean; error?: string } {
  // 1. Check file size
  if (content.length > 5 * 1024 * 1024) {
    return { safe: false, error: 'XML file size exceeds safe limit of 5MB' };
  }

  // 2. Reject DOCTYPE or entity definitions
  if (/<!DOCTYPE/i.test(content)) {
    if (/<!ENTITY/i.test(content)) {
      return { safe: false, error: 'XML entity declarations (<!ENTITY) are blocked to prevent expansion attacks.' };
    }
    if (/SYSTEM|PUBLIC/i.test(content)) {
      return { safe: false, error: 'External entity resolution is blocked.' };
    }
  }

  // 3. Limit depth
  let depth = 0;
  let maxDepth = 0;
  const tagRegex = /<(\/?[a-zA-Z_][a-zA-Z0-9_\-\.:]*)(?:\s+[^>]*)*>/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1];
    if (tag.startsWith('/') || tag.endsWith('/')) {
      if (depth > 0) depth--;
    } else {
      depth++;
      if (depth > maxDepth) {
        maxDepth = depth;
      }
      if (maxDepth > 32) {
        return { safe: false, error: 'XML nesting depth exceeds safe limit of 32.' };
      }
    }
  }

  return { safe: true };
}

export class XmlAdapter implements TrainerAdapter {
  readonly id = 'xml-adapter';
  readonly version = '1.0.0';

  supports(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.xml');
  }

  async readCurrentValue(filePath: string, pathStr: string): Promise<ReadValueResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, value: null, error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const safety = validateXmlSafety(raw);
      if (!safety.safe) {
        return { success: false, value: null, error: safety.error };
      }

      let data: any = null;
      let parseError: any = null;
      const parser = new xml2js.Parser({ async: false });
      parser.parseString(raw, (err: any, res: any) => {
        parseError = err;
        data = res;
      });
      if (parseError) throw parseError;
      
      const val = getDeepValue(data, pathStr);
      return { success: true, value: val };
    } catch (e) {
      return { success: false, value: null, error: String(e) };
    }
  }

  async dryRun(filePath: string, pathStr: string, expectedOldValue?: any): Promise<DryRunResult> {
    try {
      const res = await this.readCurrentValue(filePath, pathStr);
      if (!res.success) {
        return { success: false, error: res.error };
      }
      if (res.value === undefined) {
        return { success: false, error: `Path "${pathStr}" not found in XML` };
      }
      if (expectedOldValue !== undefined && String(res.value) !== String(expectedOldValue)) {
        return { success: false, error: `Value mismatch: current ${res.value} !== expected ${expectedOldValue}` };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async buildOutput(filePath: string, pathStr: string, newValue: any): Promise<BuildOutputResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, content: '', error: 'File does not exist' };
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const safety = validateXmlSafety(raw);
      if (!safety.safe) {
        return { success: false, content: '', error: safety.error };
      }

      let data: any = null;
      let parseError: any = null;
      const parser = new xml2js.Parser({ async: false });
      parser.parseString(raw, (err: any, res: any) => {
        parseError = err;
        data = res;
      });
      if (parseError) throw parseError;
      
      setDeepValue(data, pathStr, newValue);
      
      const builder = new xml2js.Builder();
      const output = builder.buildObject(data);
      return { success: true, content: output };
    } catch (e) {
      return { success: false, content: '', error: String(e) };
    }
  }

  async validateContent(content: string, filePath: string): Promise<ValidationResult> {
    try {
      const safety = validateXmlSafety(content);
      if (!safety.safe) {
        return { valid: false, error: safety.error };
      }

      let parseError: any = null;
      const parser = new xml2js.Parser({ async: false });
      parser.parseString(content, (err: any) => {
        parseError = err;
      });
      if (parseError) return { valid: false, error: String(parseError) };
      return { valid: true };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  async parseAndNormalize(filePath: string): Promise<ParsedDocument> {
    const diagnostics: ParserDiagnostic[] = [];
    let parsed: any = {};
    
    try {
      if (!fs.existsSync(filePath)) {
        diagnostics.push({ severity: 'error', message: 'File does not exist' });
      } else {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const safety = validateXmlSafety(raw);
        if (!safety.safe) {
          diagnostics.push({ severity: 'error', message: safety.error || 'XML safety violation' });
        } else {
          let parseError: any = null;
          const parser = new xml2js.Parser({ async: false });
          parser.parseString(raw, (err: any, res: any) => {
            parseError = err;
            parsed = res;
          });
          if (parseError) {
            diagnostics.push({ severity: 'error', message: String(parseError) });
          }
        }
      }
    } catch (err: any) {
      diagnostics.push({ severity: 'error', message: err.message });
    }

    return buildParsedDocument(this.id, this.version, filePath, 'xml', parsed, diagnostics, true);
  }
}
