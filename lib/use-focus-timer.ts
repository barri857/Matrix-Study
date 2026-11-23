'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { createFocusTimerController, FOCUS_TIMER_STORAGE_KEY, initialFocusTimer, type FocusTimerField, type FocusTimerState, type FocusTimerStorage } from './focus-timer';

/** Gate restoration with ready until account/activity loading is complete. */
export function useFocusTimer(onComplete: (minutes: number) => void, options: { ready?: boolean; storageKey?: string } = {}) {
  const ready = options.ready ?? true;
  const storageKey = options.storageKey ?? FOCUS_TIMER_STORAGE_KEY;
  const [state, setState] = useState(initialFocusTimer);
  const [focusReady, setFocusReady] = useState(false);
  const controller = useRef<ReturnType<typeof createFocusTimerController> | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;

  useEffect(() => {
    setFocusReady(false);
    if (!ready) { controller.current = null; return; }
    let storage: FocusTimerStorage | undefined;
    try { storage = window.sessionStorage; } catch { /* The in-memory timer remains available. */ }
    const timer = createFocusTimerController({ storage, storageKey, onChange: setState, onComplete: minutes => callback.current(minutes) });
    controller.current = timer;
    setState(timer.getSnapshot());
    setFocusReady(true);
    timer.tick();
    const refresh = () => timer.tick();
    const interval = window.setInterval(refresh, 500);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (controller.current === timer) controller.current = null;
    };
  }, [ready, storageKey]);

  const update = useCallback(<K extends FocusTimerField>(field: K, value: SetStateAction<FocusTimerState[K]>) => {
    controller.current?.set(field, value);
  }, []);
  const setFocusMinutes = useCallback((value: SetStateAction<number>) => update('focusMinutes', value), [update]);
  const setFocusRemaining = useCallback((value: SetStateAction<number>) => update('focusRemaining', value), [update]);
  const setFocusEnd = useCallback((value: SetStateAction<number>) => update('focusEnd', value), [update]);
  const setFocusCustom = useCallback((value: SetStateAction<boolean>) => update('focusCustom', value), [update]);

  return { ...state, focusReady, setFocusMinutes, setFocusRemaining, setFocusEnd, setFocusCustom };
}
