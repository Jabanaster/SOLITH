import React, { useEffect, useId, useMemo, useState } from 'react';
import { getWalkthrough, type WalkthroughId } from '../help/walkthroughs.js';

interface PageWalkthroughProps {
  pageId: WalkthroughId;
}

const openPages = new Set<WalkthroughId>();

export const PageWalkthrough: React.FC<PageWalkthroughProps> = ({ pageId }) => {
  const definition = useMemo(() => getWalkthrough(pageId), [pageId]);
  const panelId = useId();
  const [open, setOpen] = useState(() => openPages.has(pageId));

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      openPages.add(pageId);
    } else {
      openPages.delete(pageId);
    }
  }, [open, pageId]);

  const highlightTarget = (targetControlId: string | undefined) => {
    if (!targetControlId) return;
    const target = document.getElementById(targetControlId);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('walkthrough-target-highlight');
    window.setTimeout(() => target.classList.remove('walkthrough-target-highlight'), 1600);
  };

  return (
    <div className="page-walkthrough">
      <button
        type="button"
        className="page-walkthrough__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`How this page works: ${definition.title}`}
        title="How this page works"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
        <span>How this works</span>
      </button>

      {open && (
        <section
          id={panelId}
          className="page-walkthrough__panel"
          aria-label={definition.title}
          tabIndex={-1}
        >
          <div className="page-walkthrough__panel-header">
            <div>
              <p className="eyebrow">Page walkthrough</p>
              <h3>{definition.title}</h3>
              <p>{definition.summary}</p>
            </div>
            <button
              type="button"
              className="page-walkthrough__close"
              onClick={() => setOpen(false)}
              aria-label="Close page walkthrough"
            >
              ×
            </button>
          </div>

          <div className="page-walkthrough__sections">
            {definition.sections.map((section, index) => (
              <article
                key={section.id}
                className={`page-walkthrough__section${section.warning ? ' page-walkthrough__section--warning' : ''}`}
              >
                <div className="page-walkthrough__section-title">
                  <span aria-hidden="true">{index + 1}</span>
                  <h4>{section.title}</h4>
                </div>
                <div className="page-walkthrough__body">{section.body}</div>
                {section.targetControlId && (
                  <button
                    type="button"
                    className="page-walkthrough__show-me"
                    onClick={() => highlightTarget(section.targetControlId)}
                  >
                    Show me
                  </button>
                )}
              </article>
            ))}
          </div>

          {definition.relatedPages.length > 0 && (
            <p className="page-walkthrough__related">
              Related pages: {definition.relatedPages.join(' · ')}
            </p>
          )}
        </section>
      )}
    </div>
  );
};
