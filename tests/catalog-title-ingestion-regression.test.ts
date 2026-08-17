import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrainerListHtml } from '../src/core/trainer-catalog/sync/parse-html.js';
import { remoteTrainerToCatalogEntry } from '../src/core/trainer-catalog/sync/remote-sync.js';

describe('catalog title ingestion regression (mrantifun XenForo source)', () => {
  it('does not let forum nav-menu markup become a game title, but still parses real thread titles', () => {
    // Reproduces the real contaminated page shape observed in Phase 1C/1 catalog-title
    // hygiene tracing: a XenForo off-canvas nav menu link to an external site
    // ("Game Trainers") appears before the actual thread list on the same page.
    const html = `
      <nav class="offCanvasMenu">
        <a href="https://gametrainers.com"
        class="menu-linkRow u-indentDepth0 js-offCanvasCopy "
         >Game Trainers</a>
      </nav>
      <div class="structItemContainer">
        <a href="/threads/sniper-elite-resistance-trainer.123/">Sniper Elite: Resistance Trainer</a>
      </div>
    `;

    const trainers = parseTrainerListHtml('https://mrantifun.net', html);

    assert.ok(
      !trainers.some((t) => /href=|class=/i.test(t.gameName)),
      'no parsed gameName should contain raw HTML attribute fragments',
    );
    assert.ok(
      trainers.some((t) => t.gameName.includes('Sniper Elite')),
      'legitimate thread title must still be extracted',
    );

    for (const trainer of trainers) {
      const entry = remoteTrainerToCatalogEntry(trainer, 'mrantifun');
      assert.ok(!/href=|class=/i.test(entry.displayName));
    }
  });
});
