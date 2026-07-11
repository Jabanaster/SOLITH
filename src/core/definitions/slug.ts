/** Lowercase slug for definition ids and feature ids. */
export function slugifyDefinitionToken(value: string, maxLen = 80): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen) || 'feature';
}
