/**
 * Minimal, bounded attribute extraction for Xbox/MS Store package manifests
 * (appxmanifest.xml, MicrosoftGame.config) — real, fixed-schema Microsoft
 * XML files with a known, small set of attributes/elements. A general
 * DOM/XML parser is deliberately not used here: these files are read only
 * from a package the OS itself already registered and resolved (never
 * attacker/network-supplied), and every field this module needs is a fixed
 * attribute on a specific element — bounded regex extraction is simpler and
 * keeps XML-entity/DTD parsing surface out of a package-identity code path,
 * consistent with this codebase's existing convention of a small
 * format-specific parser over a general-purpose library (see vdf.ts for
 * Steam's VDF format).
 */
import fs from 'node:fs';

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
}

// Every tag/attribute name this module looks up is a hardcoded literal at
// the call site (never derived from file content), but building a RegExp
// from a variable still trips static ReDoS analysis (Semgrep
// detect-non-literal-regexp). These three helpers use plain string search
// instead of dynamic regex construction — equivalent for this module's
// bounded, well-formed, fixed-schema Microsoft XML inputs (see the module
// doc comment) without needing a non-literal RegExp at all.
function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

function findTagStart(xml: string, tagName: string): number {
  const needle = `<${tagName}`.toLowerCase();
  const lowerXml = xml.toLowerCase();
  let idx = 0;
  while ((idx = lowerXml.indexOf(needle, idx)) !== -1) {
    if (!isWordChar(xml[idx + needle.length])) return idx;
    idx += needle.length;
  }
  return -1;
}

function firstElement(xml: string, tagName: string): string | undefined {
  const start = findTagStart(xml, tagName);
  if (start === -1) return undefined;
  const end = xml.indexOf('>', start);
  if (end === -1) return undefined;
  return xml.slice(start, end + 1);
}

function attrValue(elementText: string | undefined, attrName: string): string | undefined {
  if (!elementText) return undefined;
  const lowerText = elementText.toLowerCase();
  const lowerAttr = attrName.toLowerCase();
  let idx = 0;
  while ((idx = lowerText.indexOf(lowerAttr, idx)) !== -1) {
    let cursor = idx + attrName.length;
    while (elementText[cursor] === ' ' || elementText[cursor] === '\t') cursor++;
    if (elementText[cursor] === '=') {
      cursor++;
      while (elementText[cursor] === ' ' || elementText[cursor] === '\t') cursor++;
      if (elementText[cursor] === '"') {
        const valueEnd = elementText.indexOf('"', cursor + 1);
        if (valueEnd !== -1) {
          const value = elementText.slice(cursor + 1, valueEnd).trim();
          return value || undefined;
        }
      }
    }
    idx += attrName.length;
  }
  return undefined;
}

function textElement(xml: string, tagName: string): string | undefined {
  const openStart = findTagStart(xml, tagName);
  if (openStart === -1) return undefined;
  const openEnd = xml.indexOf('>', openStart);
  if (openEnd === -1) return undefined;
  const nextLt = xml.indexOf('<', openEnd + 1);
  if (nextLt === -1) return undefined;
  const closeTag = `</${tagName}>`.toLowerCase();
  if (xml.slice(nextLt, nextLt + closeTag.length).toLowerCase() !== closeTag) return undefined;
  const text = xml.slice(openEnd + 1, nextLt);
  return text.trim() || undefined;
}

export interface AppxManifestInfo {
  identityName?: string;
  publisher?: string;
  version?: string;
  processorArchitecture?: string;
  displayName?: string;
  /** Every `<Application Executable="...">` declared, relative to the package root, in document order. */
  applicationExecutables: string[];
}

/** Returns null when the file is unreadable/missing or lacks a recognizable `<Identity>` element. */
export function parseAppxManifest(manifestPath: string): AppxManifestInfo | null {
  const xml = readFileSafe(manifestPath);
  if (!xml) return null;

  const identityElement = firstElement(xml, 'Identity');
  const identityName = attrValue(identityElement, 'Name');
  if (!identityName) return null;

  const propertiesMatch = /<Properties\b[^>]*>[\s\S]*?<\/Properties>/i.exec(xml);
  const displayName = propertiesMatch ? textElement(propertiesMatch[0], 'DisplayName') : undefined;

  const applicationExecutables: string[] = [];
  const applicationRe = /<Application\b[^>]*>/gi;
  let appMatch: RegExpExecArray | null;
  while ((appMatch = applicationRe.exec(xml))) {
    const exe = attrValue(appMatch[0], 'Executable');
    if (exe) applicationExecutables.push(exe);
  }

  return {
    identityName,
    publisher: attrValue(identityElement, 'Publisher'),
    version: attrValue(identityElement, 'Version'),
    processorArchitecture: attrValue(identityElement, 'ProcessorArchitecture'),
    displayName,
    applicationExecutables,
  };
}

export interface MicrosoftGameConfigInfo {
  storeId?: string;
  titleId?: string;
  displayName?: string;
  /** Every `<Executable Name="...">` declared in `<ExecutableList>`, relative to the package root. */
  executables: string[];
}

/**
 * `MicrosoftGame.config` is a real, documented file that ships only with
 * Microsoft GDK titles (current-generation Xbox/PC Game Pass games) — its
 * presence is the signal this module uses to distinguish an actual game
 * package from an arbitrary installed UWP/Store app. Returns null when
 * absent/unreadable or when the root `<Game>` element cannot be found —
 * never fabricates a game identity from a non-game package.
 */
export function parseMicrosoftGameConfig(configPath: string): MicrosoftGameConfigInfo | null {
  const xml = readFileSafe(configPath);
  if (!xml) return null;
  if (!/<Game\b/i.test(xml)) return null;

  const shellVisualsElement = firstElement(xml, 'ShellVisuals');

  const executables: string[] = [];
  const exeRe = /<Executable\b[^>]*>/gi;
  let exeMatch: RegExpExecArray | null;
  while ((exeMatch = exeRe.exec(xml))) {
    const name = attrValue(exeMatch[0], 'Name');
    if (name) executables.push(name);
  }

  return {
    storeId: textElement(xml, 'StoreId'),
    titleId: textElement(xml, 'TitleId'),
    displayName: attrValue(shellVisualsElement, 'DefaultDisplayName'),
    executables,
  };
}
