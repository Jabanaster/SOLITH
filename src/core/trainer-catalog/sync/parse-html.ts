const TRAINER_TITLE_RE = /(?:title="|>)([^<]{3,120}?\s+Trainer)\s*</gi;
const HREF_RE = /href="(\/[^"]+)"/gi;

export interface ParsedRemoteTrainer {
  title: string;
  gameName: string;
  sourceUrl: string;
}

export function parseTrainerListHtml(baseUrl: string, html: string): ParsedRemoteTrainer[] {
  const results: ParsedRemoteTrainer[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const titleRegex = /([^<>]{3,120})\s+Trainer/gi;
  while ((match = titleRegex.exec(html)) !== null) {
    const rawTitle = match[0].trim();
    const gameName = rawTitle.replace(/\s+Trainer$/i, '').trim();
    if (!gameName || gameName.length < 2) continue;
    const key = gameName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      title: rawTitle,
      gameName,
      sourceUrl: `${baseUrl.replace(/\/$/, '')}/`,
    });
  }

  // XenForo thread titles: <a href="...">Game Name Trainer</a>
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]{3,120}?\s+Trainer)<\/a>/gi;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const rawTitle = match[2].trim();
    const gameName = rawTitle.replace(/\s+Trainer$/i, '').trim();
    if (!gameName) continue;
    const key = gameName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
    results.push({ title: rawTitle, gameName, sourceUrl });
  }

  return results;
}

export function parseFlingHomeHtml(html: string): ParsedRemoteTrainer[] {
  const results: ParsedRemoteTrainer[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]+href="([^"]+)"[^>]*>([^<]{3,120})<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const label = match[2].trim();
    if (!/trainer/i.test(label) && !/\/trainer\//i.test(href)) continue;
    const gameName = label.replace(/\s+trainer.*$/i, '').trim();
    if (!gameName || gameName.length < 2) continue;
    const key = gameName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      title: label,
      gameName,
      sourceUrl: href.startsWith('http') ? href : `https://flingtrainer.com${href}`,
    });
  }
  return results;
}

export function parsePlitchGamesHtml(html: string): ParsedRemoteTrainer[] {
  const results: ParsedRemoteTrainer[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]+href="([^"]*\/games\/[^"]+)"[^>]*>([^<]{3,120})<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const gameName = match[2].trim();
    if (!gameName || gameName.length < 2) continue;
    const key = gameName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      title: gameName,
      gameName,
      sourceUrl: href.startsWith('http') ? href : `https://www.plitch.com${href}`,
    });
  }
  return results;
}
