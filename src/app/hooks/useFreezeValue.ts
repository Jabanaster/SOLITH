import { useState, useCallback, useRef, useEffect } from 'react';
import { nativeMemoryDriver } from '../../core/live-memory/native-memory-driver.js';
import type { LiveProcessHandle, LiveValueType } from '../../core/live-memory/types.js';

export interface UseFreezeValueOptions {
  handle: LiveProcessHandle | null;
  address: string | null;
  dataType: LiveValueType;
  freezeValue: number;
  isEnabled: boolean;
}

export function useFreezeValue({
  handle,
  address,
  dataType,
  freezeValue,
  isEnabled,
}: UseFreezeValueOptions) {
  const [isFrozen, setIsFrozen] = useState(false);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startFreeze = useCallback(() => {
    if (!handle || !address) {
      setFreezeError('No confirmed address');
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    setIsFrozen(true);
    setFreezeError(null);

    // Write immediately, then every 200ms
    try {
      const addr = BigInt(address);
      nativeMemoryDriver.writeMemory(handle, addr, dataType, freezeValue);
    } catch (err) {
      setFreezeError(err instanceof Error ? err.message : String(err));
      setIsFrozen(false);
      return;
    }

    intervalRef.current = setInterval(() => {
      try {
        const addr = BigInt(address);
        nativeMemoryDriver.writeMemory(handle, addr, dataType, freezeValue);
      } catch (err) {
        setFreezeError(err instanceof Error ? err.message : String(err));
        setIsFrozen(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, 200);
  }, [handle, address, dataType, freezeValue]);

  const stopFreeze = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsFrozen(false);
    setFreezeError(null);
  }, []);

  useEffect(() => {
    if (isEnabled && !isFrozen) {
      startFreeze();
    } else if (!isEnabled && isFrozen) {
      stopFreeze();
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isEnabled, isFrozen, startFreeze, stopFreeze]);

  return {
    isFrozen,
    freezeError,
    startFreeze,
    stopFreeze,
  };
}
