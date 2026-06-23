import { ParsedDocument, ParsedNode, ParserDiagnostic } from '../../shared/types';
import { assessRisk } from '../safety/index';
import path from 'path';

export function buildParsedNode(
  nodePath: string,
  key: string | undefined,
  displayName: string,
  value: any,
  parentPath: string = '',
  customPathBuilder?: (key: string, parentPath: string) => string
): ParsedNode {
  const currentPath = customPathBuilder ? customPathBuilder(key || '', parentPath) : (parentPath ? `${parentPath}.${key}` : (key || ''));
  
  if (value === null || value === undefined) {
    return {
      path: currentPath,
      key,
      displayName,
      valueType: 'null',
      value: null,
      editability: 'read-only',
      risk: 'safe',
      evidence: ['Value is null']
    };
  }

  const type = typeof value;
  
  if (type === 'object') {
    if (Array.isArray(value)) {
      const children = value.map((item, idx) => {
        const itemKey = `[${idx}]`;
        const itemPath = customPathBuilder ? customPathBuilder(itemKey, parentPath) : `${currentPath}[${idx}]`;
        return buildParsedNode(itemPath, String(idx), `Item ${idx}`, item, currentPath, customPathBuilder);
      });
      return {
        path: currentPath,
        key,
        displayName,
        valueType: 'array',
        children,
        editability: 'read-only', // Array nodes themselves aren't directly editable, their scalar children are
        risk: 'safe',
        evidence: ['Value is an array']
      };
    } else {
      const children = Object.keys(value).map(k => {
        const childPath = customPathBuilder ? customPathBuilder(k, parentPath) : (currentPath ? `${currentPath}.${k}` : k);
        return buildParsedNode(childPath, k, k, value[k], currentPath, customPathBuilder);
      });
      return {
        path: currentPath,
        key,
        displayName,
        valueType: 'object',
        children,
        editability: 'read-only', // Object nodes themselves aren't directly editable
        risk: 'safe',
        evidence: ['Value is an object']
      };
    }
  }

  // Scalar values
  let valType: 'number' | 'string' | 'boolean' | 'unknown' = 'unknown';
  if (type === 'number') valType = 'number';
  else if (type === 'string') valType = 'string';
  else if (type === 'boolean') valType = 'boolean';

  const riskAssessment = assessRisk(currentPath, String(value));
  
  let editability: 'editable' | 'read-only' | 'blocked' = 'editable';
  if (riskAssessment.risk === 'Blocked') {
    editability = 'blocked';
  }

  return {
    path: currentPath,
    key,
    displayName,
    valueType: valType,
    value,
    editability,
    risk: riskAssessment.risk.toLowerCase() as 'safe' | 'caution' | 'risky' | 'blocked',
    evidence: [riskAssessment.reason]
  };
}

export function buildParsedDocument(
  adapterId: string,
  adapterVersion: string,
  sourcePath: string,
  format: string,
  rootData: any,
  diagnostics: ParserDiagnostic[] = [],
  editable: boolean = true,
  customPathBuilder?: (key: string, parentPath: string) => string
): ParsedDocument {
  const rootNode = buildParsedNode('', undefined, path.basename(sourcePath), rootData, '', customPathBuilder);
  
  return {
    adapterId,
    adapterVersion,
    sourcePath,
    format,
    root: rootNode,
    diagnostics,
    editable: editable && rootNode.editability !== 'blocked'
  };
}
