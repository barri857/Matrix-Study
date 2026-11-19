export type SavedAIConnection = {provider: string; model: string; apiKey: string; remember: boolean};
type StoredConnection = SavedAIConnection & {revocation?: string};
const PROFILES = 'matrix-api-profiles';
const ACTIVE = 'matrix-api';
export const AI_CONNECTION_REVOCATIONS_KEY = 'matrix-api-revocations';
const PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'deepseek']);

function storage(kind: 'sessionStorage' | 'localStorage'): Storage | null {
  try { return globalThis[kind]; } catch { return null; }
}
function read(store: Storage | null, key: string): unknown {
  try { return JSON.parse(store?.getItem(key) || 'null'); } catch { return null; }
}
function connection(value: unknown): StoredConnection | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<StoredConnection>;
  if (typeof item.provider !== 'string' || !PROVIDERS.has(item.provider) || typeof item.model !== 'string' || item.model.length > 150 || typeof item.apiKey !== 'string' || item.apiKey.length > 4096 || /[\r\n]/.test(item.apiKey)) return null;
  return {provider: item.provider, model: item.model.trim(), apiKey: item.apiKey.trim(), remember: item.remember === true, ...(typeof item.revocation === 'string' && item.revocation.length <= 100 ? {revocation: item.revocation} : {})};
}
function revocations(): Record<string, string> {
  const value = read(storage('localStorage'), AI_CONNECTION_REVOCATIONS_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([provider, stamp]) => PROVIDERS.has(provider) && typeof stamp === 'string' && stamp.length <= 100));
}
function current(item: StoredConnection): boolean {
  return (item.revocation || '') === (revocations()[item.provider] || '');
}
function storedProfiles(store: Storage | null, persistent: boolean): Record<string, StoredConnection> {
  const result: Record<string, StoredConnection> = {};
  const value = read(store, PROFILES);
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [provider, raw] of Object.entries(value)) {
    const item = connection(raw);
    if (item && item.provider === provider && current(item) && (!persistent || item.remember && !!item.apiKey)) result[provider] = item;
  }
  // Migrate the original single-provider record before a new selection overwrites it.
  const legacy = connection(read(store, ACTIVE));
  if (legacy && current(legacy) && (!persistent || legacy.remember && !!legacy.apiKey) && !Object.hasOwn(result, legacy.provider)) result[legacy.provider] = legacy;
  return result;
}
function publicConnection(item: StoredConnection): SavedAIConnection {
  return {provider: item.provider, model: item.model, apiKey: item.apiKey, remember: item.remember};
}
function removePersistent(provider: string) {
  const store = storage('localStorage');
  if (!store) return;
  const saved = storedProfiles(store, true);
  delete saved[provider];
  store.setItem(PROFILES, JSON.stringify(saved));
  const active = connection(read(store, ACTIVE));
  if (active?.provider === provider || !active) store.removeItem(ACTIVE);
}

/** Keys stay in browser storage and are excluded from workspace sync/exports. */
export function loadAIConnection(provider?: string): SavedAIConnection | null {
  if (provider && !PROVIDERS.has(provider)) return null;
  const session = storage('sessionStorage'), local = storage('localStorage');
  if (provider) {
    const item = storedProfiles(session, false)[provider] || storedProfiles(local, true)[provider];
    return item ? publicConnection(item) : null;
  }
  for (const [store, persistent] of [[session, false], [local, true]] as const) {
    const item = connection(read(store, ACTIVE));
    if (item && current(item) && (!persistent || item.remember && !!item.apiKey)) return publicConnection(item);
  }
  return null;
}

/** Editing remembers the tab's provider; switching off Remember removes its disk copy immediately. */
export function keepAIConnectionInTab(value: SavedAIConnection) {
  const item = connection(value);
  if (!item) throw new Error('This AI connection is not valid.');
  const next = {...item, revocation: revocations()[item.provider] || ''};
  const session = storage('sessionStorage');
  let failed = false;
  try {
    if (!session) throw new Error();
    const saved = storedProfiles(session, false);
    saved[next.provider] = next;
    session.setItem(PROFILES, JSON.stringify(saved));
    session.setItem(ACTIVE, JSON.stringify(next));
  } catch { failed = true; }
  try { if (!next.remember) removePersistent(next.provider); } catch { failed = true; }
  if (failed) throw new Error('Browser storage is unavailable. Your connection is available only until this page closes.');
}

export function saveAIConnection(value: SavedAIConnection) {
  const item = connection(value);
  if (!item) throw new Error('This AI connection is not valid.');
  let failure: unknown;
  try { keepAIConnectionInTab(item); } catch (error) { failure = error; }
  try {
    if (item.remember && item.apiKey) {
      const local = storage('localStorage');
      if (!local) throw new Error('Browser storage is unavailable.');
      const saved = storedProfiles(local, true);
      saved[item.provider] = {...item, revocation: revocations()[item.provider] || ''};
      local.setItem(PROFILES, JSON.stringify(saved));
      local.setItem(ACTIVE, JSON.stringify(saved[item.provider]));
    } else removePersistent(item.provider);
  } catch (error) { failure = error; }
  if (failure) throw failure;
}

export function forgetAIConnection(provider: string) {
  if (!PROVIDERS.has(provider)) return;
  let failure: unknown;
  const local = storage('localStorage');
  // A stamp prevents another tab's old session records being restored after disconnect.
  try { local?.setItem(AI_CONNECTION_REVOCATIONS_KEY, JSON.stringify({...revocations(), [provider]: crypto.randomUUID()})); }
  catch (error) { failure = error; }
  for (const [store, persistent] of [[storage('sessionStorage'), false], [local, true]] as const) {
    if (!store) continue;
    try {
      const saved = storedProfiles(store, persistent);
      delete saved[provider];
      store.setItem(PROFILES, JSON.stringify(saved));
      const active = connection(read(store, ACTIVE));
      if (active?.provider === provider || !active) store.removeItem(ACTIVE);
    } catch (error) { failure = error; }
  }
  if (failure) throw failure;
}
