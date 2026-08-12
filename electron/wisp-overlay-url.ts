import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function getWispOverlayUrl(moduleDirectory: string, isDev = false): string {
  if (isDev) {
    return 'http://localhost:3000/#wisp-overlay';
  }
  const overlayUrl = pathToFileURL(path.join(moduleDirectory, 'dist/index.html'));
  overlayUrl.hash = 'wisp-overlay';
  return overlayUrl.href;
}
