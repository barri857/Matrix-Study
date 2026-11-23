export type FocusTimerState = {
  version: 1;
  focusMinutes: number;
  focusRemaining: number;
  focusEnd: number;
  focusCustom: boolean;
};
export type FocusTimerField = Exclude<keyof FocusTimerState, 'version'>;
export type FocusTimerStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const FOCUS_TIMER_STORAGE_KEY = 'matrix-focus-timer-v1';
export const initialFocusTimer = (): FocusTimerState => ({ version: 1, focusMinutes: 25, focusRemaining: 1500, focusEnd: 0, focusCustom: false });
export const validFocusMinutes = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 240;

function remainingAt(state: FocusTimerState, now: number) {
  return state.focusEnd ? Math.min(state.focusMinutes * 60, Math.max(0, Math.ceil((state.focusEnd - now) / 1000))) : state.focusRemaining;
}

/** Stored timers are data, not trusted settings. Expired deadlines remain present
 * until tick claims completion; a stopped zero timer has already been claimed. */
export function readFocusTimer(value: unknown, now = Date.now()): FocusTimerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return initialFocusTimer();
  const candidate = value as Partial<FocusTimerState>;
  if (candidate.version !== 1 || !validFocusMinutes(candidate.focusMinutes)
    || typeof candidate.focusCustom !== 'boolean'
    || typeof candidate.focusRemaining !== 'number' || !Number.isInteger(candidate.focusRemaining) || candidate.focusRemaining < 0 || candidate.focusRemaining > candidate.focusMinutes * 60
    || typeof candidate.focusEnd !== 'number' || !Number.isSafeInteger(candidate.focusEnd) || candidate.focusEnd < 0
    || candidate.focusEnd > now + candidate.focusMinutes * 60000 + 1000) return initialFocusTimer();
  const state: FocusTimerState = { version: 1, focusMinutes: candidate.focusMinutes, focusRemaining: candidate.focusRemaining, focusEnd: candidate.focusEnd, focusCustom: candidate.focusCustom };
  return { ...state, focusRemaining: remainingAt(state, now) };
}

export function updateFocusTimer<K extends FocusTimerField>(state: FocusTimerState, field: K, value: FocusTimerState[K], now = Date.now()): FocusTimerState {
  if (field === 'focusMinutes') {
    if (!validFocusMinutes(value)) return state;
    return { ...state, focusMinutes: value, focusRemaining: value * 60, focusEnd: 0 };
  }
  if (field === 'focusCustom') return typeof value === 'boolean' ? { ...state, focusCustom: value } : state;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return state;
  if (field === 'focusRemaining') return value <= state.focusMinutes * 60 ? { ...state, focusRemaining: value, focusEnd: 0 } : state;
  if (field === 'focusEnd') {
    if (value > now + state.focusMinutes * 60000 + 1000) return state;
    if (value === 0) return { ...state, focusRemaining: remainingAt(state, now), focusEnd: 0 };
    return { ...state, focusEnd: value, focusRemaining: remainingAt({ ...state, focusEnd: value }, now) };
  }
  return state;
}

/** Each browser tab has its own storage. Mutations persist synchronously, so a
 * refresh immediately after Start or Pause cannot lose the new timer state. */
export function createFocusTimerController(options: {
  storage?: FocusTimerStorage;
  storageKey?: string;
  now?: () => number;
  onChange?: (state: FocusTimerState) => void;
  onComplete?: (minutes: number) => void;
}) {
  const now = options.now ?? Date.now;
  const key = options.storageKey ?? FOCUS_TIMER_STORAGE_KEY;
  let state = initialFocusTimer();
  try { const saved = options.storage?.getItem(key); if (saved) state = readFocusTimer(JSON.parse(saved), now()); } catch { /* A corrupt/unavailable cache starts a fresh timer. */ }
  function save() {
    try { options.storage?.setItem(key, JSON.stringify(state)); } catch { /* Timer still works for this session when storage is blocked. */ }
  }
  function publish(next: FocusTimerState, persist: boolean) {
    if (Object.keys(next).every(key => next[key as keyof FocusTimerState] === state[key as keyof FocusTimerState])) return;
    state = next;
    if (persist) save();
    options.onChange?.(state);
  }
  return {
    getSnapshot: () => state,
    set<K extends FocusTimerField>(field: K, value: FocusTimerState[K] | ((previous: FocusTimerState[K]) => FocusTimerState[K])) {
      const resolved = typeof value === 'function' ? value(state[field]) : value;
      publish(updateFocusTimer(state, field, resolved, now()), true);
    },
    tick() {
      if (!state.focusEnd) return;
      const remaining = remainingAt(state, now());
      if (remaining > 0) { publish({ ...state, focusRemaining: remaining }, false); return; }
      const completedMinutes = state.focusMinutes;
      // Claim completion before notifying React/user code. Reloading a completed
      // snapshot cannot award minutes twice, including React's StrictMode mount.
      publish({ ...state, focusRemaining: 0, focusEnd: 0 }, true);
      options.onComplete?.(completedMinutes);
    },
  };
}
