/**
 * Minimal Valve Data Format parser for Steam libraryfolders.vdf and appmanifest_*.acf.
 */
export function parseVdf(text: string): Record<string, unknown> {
  const tokens = tokenizeVdf(text);
  const [value] = parseVdfNode(tokens, 0);
  return (value as Record<string, unknown>) ?? {};
}

function tokenizeVdf(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '{' || ch === '}') {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let value = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
        } else {
          value += input[i];
          i += 1;
        }
      }
      i += 1;
      tokens.push(value);
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    let bare = '';
    while (i < input.length && !/\s/.test(input[i]) && input[i] !== '{' && input[i] !== '}') {
      bare += input[i];
      i += 1;
    }
    if (bare) tokens.push(bare);
  }
  return tokens;
}

function parseVdfNode(tokens: string[], index: number): [unknown, number] {
  const obj: Record<string, unknown> = {};
  let i = index;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '}') return [obj, i + 1];
    const key = token;
    i += 1;
    if (i >= tokens.length) break;
    if (tokens[i] === '{') {
      const [child, next] = parseVdfNode(tokens, i + 1);
      obj[key] = child;
      i = next;
      continue;
    }
    obj[key] = tokens[i];
    i += 1;
  }
  return [obj, i];
}

export function vdfStringValue(node: Record<string, unknown>, key: string): string | undefined {
  const value = node[key];
  return typeof value === 'string' ? value : undefined;
}
