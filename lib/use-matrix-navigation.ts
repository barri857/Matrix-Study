'use client';

import {useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react';
import {DEFAULT_NAVIGATION, matrixNavigationHash, matrixNavigationUrl, parseMatrixNavigation, resolveNavigationSelection, validMatrixView, type GuideMode, type MatrixNavigation, type MatrixView} from './navigation';

type HistoryMode = 'push' | 'replace';
type Options = {kits: readonly {id: string}[]; ready: boolean};
const resolveUpdate = <T,>(update: SetStateAction<T>, previous: T): T => typeof update === 'function' ? (update as (value: T) => T)(previous) : update;

/** Drop-in setters keep current Matrix actions batched into one browser history entry. */
export function useMatrixNavigation({kits, ready}: Options) {
  // Start identically during SSR and hydration; restore the browser URL after mount.
  const [route, setRoute] = useState<MatrixNavigation>(() => ({...DEFAULT_NAVIGATION}));
  const [restored, setRestored] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const nextWrite = useRef<HistoryMode>('replace');
  const observedHash = useRef('');

  useEffect(() => {
    const initial = parseMatrixNavigation(window.location.hash);
    nextWrite.current = 'replace';
    setRoute(initial); setRestored(true);
    observedHash.current = window.location.hash;
    const restore = () => {
      // Browsers can emit both popstate and hashchange for one history traversal.
      if (observedHash.current === window.location.hash) return;
      observedHash.current = window.location.hash;
      nextWrite.current = 'replace';
      setRoute(parseMatrixNavigation(observedHash.current));
      setHistoryVersion(version => version + 1);
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore);};
  }, []);

  useEffect(() => {
    if (!restored) return;
    const resolved = resolveNavigationSelection(route, kits, ready);
    if (resolved !== route) {
      nextWrite.current = 'replace';
      setRoute(resolved);
      return;
    }
    const hash = matrixNavigationHash(route);
    if (window.location.hash !== hash) {
      const url = matrixNavigationUrl(window.location, route);
      // Keep any framework metadata already attached to this history entry.
      if (nextWrite.current === 'push') window.history.pushState(window.history.state, '', url);
      else window.history.replaceState(window.history.state, '', url);
    }
    observedHash.current = window.location.hash;
    nextWrite.current = 'push';
  }, [route, kits, ready, restored]);

  const setView: Dispatch<SetStateAction<MatrixView>> = useCallback(update => {
    nextWrite.current = 'push';
    setRoute(previous => {
      const view = resolveUpdate(update, previous.view);
      return validMatrixView(view) && view !== previous.view ? {...previous, view} : previous;
    });
  }, []);
  const setSelected: Dispatch<SetStateAction<string>> = useCallback(update => {
    nextWrite.current = 'push';
    setRoute(previous => {
      const selected = resolveUpdate(update, previous.selected);
      if (selected !== '' && !/^[a-zA-Z0-9_-]{1,100}$/.test(selected)) return previous;
      return selected !== previous.selected ? {...previous, selected} : previous;
    });
  }, []);
  const setGuideMode: Dispatch<SetStateAction<GuideMode>> = useCallback(update => {
    nextWrite.current = 'push';
    setRoute(previous => {
      const guideMode = resolveUpdate(update, previous.guideMode);
      return (guideMode === 'guide' || guideMode === 'summary') && guideMode !== previous.guideMode ? {...previous, guideMode} : previous;
    });
  }, []);
  return {...route, setView, setSelected, setGuideMode, restored, historyVersion};
}
