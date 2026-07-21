import { useEffect, useRef } from 'react';
import styles from './OpeningCinematic.module.css';

interface OpeningCinematicProps {
  source: string;
  onComplete: () => void;
}

export function OpeningCinematic({ source, onComplete }: OpeningCinematicProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const skipButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const play = async () => {
      try {
        await video.play();
      } catch {
        // Keep the visual intro available if Chromium blocks audible autoplay.
        video.muted = true;
        try {
          await video.play();
        } catch {
          if (!cancelled) onComplete();
        }
      }
    };

    void play();
    const safetyTimeout = window.setTimeout(onComplete, 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimeout);
    };
  }, [onComplete]);

  useEffect(() => {
    skipButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onComplete();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onComplete]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Solith opening cinematic"
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={source}
        autoPlay
        playsInline
        preload="auto"
        onEnded={onComplete}
        onError={onComplete}
      />
      <button
        ref={skipButtonRef}
        className={styles.skip}
        type="button"
        onClick={onComplete}
      >
        Skip intro
        <span aria-hidden="true">Esc</span>
      </button>
    </div>
  );
}
