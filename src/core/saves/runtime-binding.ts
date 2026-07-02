import path from 'path';

export interface RuntimeSaveLocationBindingInput {
  filePath: string;
  approvedRoots: string[];
  allowFileNames?: string[];
}

export interface RuntimeSaveLocationBindingResult {
  approved: true;
  resolvedPath: string;
  root: string;
}

function hasTraversal(rawPath: string): boolean {
  return rawPath.split(/[\\/]+/).includes('..');
}

function isInsideOrEqual(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateRuntimeSaveLocationBinding(
  input: RuntimeSaveLocationBindingInput,
): RuntimeSaveLocationBindingResult {
  if (!input.filePath || typeof input.filePath !== 'string') {
    throw new Error('runtime_save_binding_invalid: filePath is required');
  }
  if (input.filePath.includes('{') || input.filePath.includes('}')) {
    throw new Error('runtime_save_binding_invalid: unresolved template variable');
  }
  if (hasTraversal(input.filePath)) {
    throw new Error('runtime_save_binding_rejected: path traversal is not allowed');
  }

  const roots = input.approvedRoots.map(root => path.resolve(root));
  if (roots.length === 0) {
    throw new Error('runtime_save_binding_rejected: no approved roots');
  }

  const resolvedPath = path.resolve(input.filePath);
  if (input.allowFileNames && input.allowFileNames.length > 0 && !input.allowFileNames.includes(path.basename(resolvedPath))) {
    throw new Error('runtime_save_binding_rejected: file name is not registered for this profile');
  }

  const root = roots.find(candidate => isInsideOrEqual(resolvedPath, candidate));
  if (!root) {
    throw new Error('runtime_save_binding_rejected: path is outside approved save roots');
  }

  return { approved: true, resolvedPath, root };
}
