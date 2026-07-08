import React, { useEffect, useState, useCallback } from 'react';
import styles from './PalworldTrainerPage.module.css';
import { PalworldCheatMenu } from '../components/PalworldCheatMenu.js';
import { LiveTrainer } from '../components/LiveTrainer.js';
import { trainerSessionCache } from '../stores/trainerSessionCache.js';
import { getCheatById } from '../../core/live-memory/palworld-cheats.js';

interface ActiveCheat {
  cheatId: string;
  isEnabled: boolean;
  isFrozen: boolean;
}

export default function PalworldTrainerPage() {
  const [userConfirmedOffline, setUserConfirmedOffline] = useState(false);
  const [activeCheats, setActiveCheats] = useState<Map<string, ActiveCheat>>(new Map());
  const [showAdvancedMode, setShowAdvancedMode] = useState(false);

  useEffect(() => {
    return () => {
      trainerSessionCache.clearAll();
    };
  }, []);

  const handleCheatToggle = useCallback((cheatId: string, enabled: boolean, value: number) => {
    setActiveCheats((prev) => {
      const next = new Map(prev);
      if (enabled) {
        next.set(cheatId, { cheatId, isEnabled: true, isFrozen: false });
      } else {
        next.delete(cheatId);
      }
      return next;
    });
  }, []);

  const handleCheatFreeze = useCallback((cheatId: string, enabled: boolean) => {
    setActiveCheats((prev) => {
      const next = new Map(prev);
      const cheat = next.get(cheatId);
      if (cheat) {
        cheat.isFrozen = enabled;
      }
      return next;
    });
  }, []);

  const handleCheatDiscover = useCallback((cheatId: string) => {
    const cheat = getCheatById(cheatId);
    if (!cheat || !cheat.requiresDiscovery) return;
    // Discovery workflow will be initiated by the cheat menu
    // For now, just mark it as discovering
  }, []);

  return (
    <div className={styles['page-container']}>
      <header className={styles['page-header']}>
        <h1>Palworld Live Trainer</h1>
        <p className={styles['page-subtitle']}>
          {showAdvancedMode
            ? 'Auto-discover and modify game values in real-time (solo mode only)'
            : 'One-click cheats with real-time freeze (solo mode only)'}
        </p>
      </header>

      <main className={styles['page-content']}>
        <section className={styles['trainer-section']}>
          <div className={styles['trainer-intro']}>
            <h2>Safety Confirmation Required</h2>
            <label className={styles['confirmation-label']}>
              <input
                type="checkbox"
                checked={userConfirmedOffline}
                onChange={(e) => setUserConfirmedOffline(e.target.checked)}
              />
              <span>
                I confirm this Palworld session is <strong>single-player/offline only</strong> and not connected to other players or servers.
              </span>
            </label>
            {!userConfirmedOffline && (
              <p className={styles['warning-message']}>
                ⚠️ You must confirm before using the trainer. This is a fail-closed safety check.
              </p>
            )}

            {userConfirmedOffline && (
              <div className={styles['mode-toggle']}>
                <label>
                  <input
                    type="checkbox"
                    checked={showAdvancedMode}
                    onChange={(e) => setShowAdvancedMode(e.target.checked)}
                  />
                  <span>Advanced Mode (manual value discovery)</span>
                </label>
              </div>
            )}

            <p className={styles['safety-note']}>
              ⚠️ <strong>Solo mode only.</strong> Every write is rechecked against Palworld's live connection count (baseline: 4 for Steamworks overhead).
            </p>
          </div>
        </section>

        {userConfirmedOffline && !showAdvancedMode && (
          <section className={styles['trainer-section']}>
            <PalworldCheatMenu
              userConfirmedOffline={userConfirmedOffline}
              onCheatToggle={handleCheatToggle}
              onCheatFreeze={handleCheatFreeze}
              onCheatDiscover={handleCheatDiscover}
            />
          </section>
        )}

        {userConfirmedOffline && showAdvancedMode && (
          <>
            <section className={styles['trainer-section']}>
              <h2>How It Works (Advanced Mode)</h2>
              <ol>
                <li><strong>Scan</strong>: Enter your current in-game value (gold, health, etc.)</li>
                <li><strong>Change</strong>: Modify the value in-game</li>
                <li><strong>Narrow</strong>: Tell me the new value, I'll find the exact address</li>
                <li><strong>Write</strong>: One-click to modify the value</li>
              </ol>
            </section>

            <section className={styles['trainer-section']}>
              <LiveTrainer
                gameName="Palworld"
                executable="Palworld-Win64-Shipping.exe"
                dataType="int32"
                displayName="Gold"
                userConfirmedOffline={userConfirmedOffline}
              />
            </section>

            <section className={styles['trainer-section']}>
              <LiveTrainer
                gameName="Palworld"
                executable="Palworld-Win64-Shipping.exe"
                dataType="int32"
                displayName="Health"
                userConfirmedOffline={userConfirmedOffline}
              />
            </section>
          </>
        )}

        {userConfirmedOffline && (
          <section className={`${styles['trainer-section']} ${styles['info-section']}`}>
            <h2>About Live Trainer</h2>
            <p>
              This trainer discovers and modifies memory values in real-time without restarting the game.
              It uses the same read/write techniques as WeMod, but with a strict offline-only gate:
              if you confirmed this session is single-player, but the game actually has active network
              connections, the write is automatically blocked.
            </p>
            <h3>How addresses are found</h3>
            <p>
              Each session, ASLR randomizes where code and data are loaded in memory. That means yesterday's
              gold address won't work today. This trainer solves that by finding the address automatically:
              it scans all of Palworld's memory for values you specify, then narrows down by checking which
              address changed when you changed the value in-game. Usually 2-3 changes narrows it down to 1.
            </p>
            <h3>Persistent addresses (multi-session)</h3>
            <p>
              The raw address changes every session due to ASLR. If you want to write to gold reliably
              across game restarts, we'd need to discover a pointer chain (like WeMod's Atomfall support).
              Palworld doesn't have stable chains, so you'll re-scan each session. (This takes ~30 seconds total.)
            </p>
            <h3>Freeze Feature</h3>
            <p>
              Enable freeze on any cheat to maintain that infinite value continuously. The trainer re-writes
              the value every 200ms to counteract any game updates or player actions that would change it.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
