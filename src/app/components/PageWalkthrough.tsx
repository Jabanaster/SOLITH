import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getWalkthrough, type WalkthroughId } from '../help/walkthroughs.js';

interface PageWalkthroughProps {
  pageId: WalkthroughId;
}

interface WalkthroughOwnerValue {
  openPageId: WalkthroughId | null;
  setOpenPageId: React.Dispatch<React.SetStateAction<WalkthroughId | null>>;
}

const WalkthroughOwnerContext = createContext<WalkthroughOwnerValue | null>(null);

export function WalkthroughOwner({ children }: { children: React.ReactNode }) {
  const [openPageId, setOpenPageId] = useState<WalkthroughId | null>(null);
  const value = useMemo(() => ({ openPageId, setOpenPageId }), [openPageId]);

  return (
    <WalkthroughOwnerContext.Provider value={value}>
      {children}
    </WalkthroughOwnerContext.Provider>
  );
}

export const PageWalkthrough: React.FC<PageWalkthroughProps> = ({ pageId }) => {
  const definition = useMemo(() => getWalkthrough(pageId), [pageId]);
  const panelId = useId();
  const owner = useContext(WalkthroughOwnerContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = owner ? owner.openPageId === pageId : localOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previouslyOpen = useRef(false);

  const setOpen = (nextOpen: boolean) => {
    if (owner) {
      owner.setOpenPageId(nextOpen ? pageId : null);
    } else {
      setLocalOpen(nextOpen);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, owner, pageId]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    } else if (previouslyOpen.current) {
      triggerRef.current?.focus();
    }
    previouslyOpen.current = open;
  }, [open]);

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
        ref={triggerRef}
        type="button"
        className="page-walkthrough__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`How this page works: ${definition.title}`}
        title="How this page works"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">?</span>
        <span>How this works</span>
      </button>

      {open && (
        <section
          ref={panelRef}
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