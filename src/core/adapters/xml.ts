import fs from 'fs';
import xml2js from 'xml2js';
import { TrainerAdapter, ReadValueResult, DryRunResult, BuildOutputResult, ValidationResult } from './contract';
import { getDeepValue, setDeepValue } from './json';
import { ParsedDocument, ParserDiagnostic } from '../../shared/types';
import { buildParsedDocument } from '../saves/normalization';

// Bounded single-pass structural depth scan. Not a full XML parser — it only
// tracks enough state (comment/CDATA/PI/markup-declaration skipping, quoted
// attribute values) to count element nesting correctly without being fooled
// by '<'/'>' characters that appear inside those constructs. A prior regex
// implementation (`/<(\/?[a-zA-Z_][a-zA-Z0-9_\-\.:]*)(?:\s+[^>]*)*>/g`)
// counted fake tags found inside comments/CDATA and mis-terminated tags on a
// quoted '>' inside an attribute value, both of which under- or over-count
// real structural depth. This walks the string once (O(n), no backtracking)
// so it stays cheap enough to run before considering the document safe to
// hand to a full parser.
function scanXmlStructuralDepth(content: string, maxDepth: number): { exceeded: boolean; maxDepthSeen: number } {
  const len = content.length;
  let i = 0;
  let depth = 0;
  let maxDepthSeen = 0;

  while (i < len) {
    if (content[i] !== '<') {
      i++;
      continue;
    }

    if (content.startsWith('<!--', i)) {
      const end = content.indexOf('-->', i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }

    if (content.startsWith('<![CDATA[', i)) {
      const end = content.indexOf(']]>', i + 9);
      i = end === -1 ? len : end + 3;
      continue;
    }

    if (content.startsWith('<?', i)) {
      const end = content.indexOf('?>', i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }

    // Any other markup declaration (DOCTYPE internal subsets, etc.). DOCTYPE
    // itself is already rejected before this function runs, but this branch
    // stays as defense-in-depth against other '<!...>' constructs and skips
    // to the matching top-level '>', respecting a bracketed internal subset
    // which may itself contain unquoted '>' characters.
    if (content.startsWith('<!', i)) {
      let j = i + 2;
      let bracketDepth = 0;
      while (j < len) {
        const c = content[j];
        if (c === '[') bracketDepth++;
        else if (c === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (c === '>' && bracketDepth === 0) break;
        j++;
      }
      i = j < len ? j + 1 : len;
      continue;
    }

    // Element start/end tag: scan to the matching unquoted '>', tracking
    // quoted attribute values so a '>' inside "..." or '...' doesn't
    // terminate the tag early.
    let j = i + 1;
    let quote: string | null = null;
    while (j < len) {
      const c = content[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }

    if (j >= len) {
      // Unterminated tag — nothing further to structurally count. The
      // downstream XML parser will reject this document as malformed.
      break;
    }

    const tagBody = content.slice(i + 1, j);
    const isClosing = tagBody.startsWith('/');
    const isSelfClosing = tagBody.endsWith('/');

    if (isClosing) {
      if (depth > 0) depth--;
    } else if (!isSelfClosing) {
      depth++;
      if (depth > maxDepthSeen) maxDepthSeen = depth;
      if (maxDepthSeen > maxDepth) {
        return { exceeded: true, maxDepthSeen };
      }
    }

    i = j + 1;
  }

  return { exceeded: false, maxDepthSeen };
}

export function validateXmlSafety(content: string): { safe: boolean; error?: string } {
  // 1. Check file size
  if (content.length > 5 * 1024 * 1024) {
    return { safe: false, error: 'XML file size exceeds safe limit of 5MB' };
  }

  // 2. Reject DOCTYPE and entity definitions outright. A bare DOCTYPE with no
  // visible ENTITY/SYSTEM/PUBLIC is still rejected — parsers can resolve
  // internal subsets or externally-referenced DTDs the regex above can't see,
  // so "no entity keyword present" is not proof of safety.
  if (/<!DOCTYPE/i.test(content)) {
    return { safe: false, error: 'XML DOCTYPE declarations are blocked to prevent entity expansion and external entity resolution attacks.' };
  }

  // 3. Limit depth. Real community Cheat Engine tables nest CheatEntry
  // category folders far deeper than a typical save-editor XML document —
  // a genuine CrimsonDesert.CT fixture reaches depth 75 with no malicious
  // intent. 32 rejected real, legitimate tables outright (discovered when
  // Finding 1's fix wired this same validator into the metadata/script
  // fallback path, which had never enforced it before). 256 stays orders of
  // magnitude below any realistic engineered stack-exhaustion depth while
  // comfortably covering real-world nesting.
  const MAX_XML_DEPTH = 256;
  const { exceeded } = scanXmlStructuralDepth(content, MAX_XML_DEPTH);
  if (exceeded) {
    return { safe: false, error: `XML nesting depth exceeds safe limit of ${MAX_XML_DEPTH}.` };
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
