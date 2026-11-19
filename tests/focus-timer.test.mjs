import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusTimerController, initialFocusTimer, readFocusTimer, validFocusMinutes, FOCUS_TIMER_STORAGE_KEY } from '../lib/focus-timer.ts';

function fixture() {
  let time = 1800000000000;
  const values = new Map(), completed = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const create = () => createFocusTimerController({ storage, now: () => time, onComplete: minutes => completed.push(minutes) });
  return { create, completed, values, advance: milliseconds => { time += milliseconds; }, now: () => time };
}

test('running custom timer survives refresh with its deadline and accurate remaining time', () => {
  const app = fixture();
  let timer = app.create();
  timer.set('focusCustom', true); timer.set('focusMinutes', 37); timer.set('focusRemaining', 37 * 60); timer.set('focusEnd', app.now() + 37 * 60000);
  const deadline = timer.getSnapshot().focusEnd;
  app.advance(91000);
  timer = app.create();
  assert.deepEqual(timer.getSnapshot(), { version: 1, focusMinutes: 37, focusCustom: true, focusEnd: deadline, focusRemaining: 2129 });
  app.advance(1001); timer.tick();
  assert.equal(timer.getSnapshot().focusRemaining, 2128);
  assert.deepEqual(app.completed, []);
});

test('pausing and resuming preserves remaining time across repeated refreshes', () => {
  const app = fixture(); let timer = app.create();
  timer.set('focusEnd', app.now() + 1500000);
  app.advance(123400); timer.set('focusEnd', 0);
  assert.equal(timer.getSnapshot().focusRemaining, 1377);
  app.advance(3600000); timer = app.create();
  assert.equal(timer.getSnapshot().focusRemaining, 1377);
  assert.equal(timer.getSnapshot().focusEnd, 0);
  timer.set('focusEnd', app.now() + 1377000); app.advance(77000);
  timer = app.create(); assert.equal(timer.getSnapshot().focusRemaining, 1300);
});

test('expired restored session is awarded exactly once before and after another refresh', () => {
  const app = fixture(); let timer = app.create();
  timer.set('focusMinutes', 1); timer.set('focusEnd', app.now() + 60000);
  app.advance(61000); timer = app.create();
  assert.deepEqual(app.completed, []);
  timer.tick(); timer.tick();
  assert.deepEqual(app.completed, [1]);
  const saved = JSON.parse(app.values.get(FOCUS_TIMER_STORAGE_KEY));
  assert.equal(saved.focusEnd, 0); assert.equal(saved.focusRemaining, 0);
  timer = app.create(); timer.tick();
  assert.deepEqual(app.completed, [1]);
  // A newly started session may complete and award its minutes independently.
  timer.set('focusEnd', app.now() + 60000); app.advance(60000); timer.tick();
  assert.deepEqual(app.completed, [1, 1]);
});

test('reset and preset changes stop an old deadline without completing it', () => {
  const app = fixture(); const timer = app.create();
  timer.set('focusCustom', true); timer.set('focusMinutes', 9); timer.set('focusEnd', app.now() + 540000);
  timer.set('focusEnd', 0); timer.set('focusRemaining', 540);
  app.advance(600000); timer.tick(); assert.deepEqual(app.completed, []);
  timer.set('focusEnd', app.now() + 540000);
  timer.set('focusCustom', false); timer.set('focusMinutes', 5); timer.set('focusRemaining', 300); timer.set('focusEnd', 0);
  assert.deepEqual(app.create().getSnapshot(), { version: 1, focusMinutes: 5, focusRemaining: 300, focusEnd: 0, focusCustom: false });
});

test('invalid stored durations, deadlines, and incomplete snapshots are discarded', () => {
  for (const minutes of [0, -1, 241, 1.5, Infinity, NaN, '25']) assert.equal(validFocusMinutes(minutes), false);
  const current = initialFocusTimer(), now = 1800000000000;
  for (const value of [null, [], {}, { ...current, version: 2 }, { ...current, focusMinutes: 241 }, { ...current, focusEnd: now + 999999999 }, { ...current, focusRemaining: 1501 }, { ...current, focusRemaining: -1 }, { ...current, focusCustom: 'yes' }]) assert.deepEqual(readFocusTimer(value, now), current);
  const app = fixture(); app.values.set(FOCUS_TIMER_STORAGE_KEY, 'not json');
  assert.deepEqual(app.create().getSnapshot(), current);
  const timer = app.create(); timer.set('focusMinutes', 240); timer.set('focusMinutes', 241);
  assert.equal(timer.getSnapshot().focusMinutes, 240);
});

test('separate tab stores isolate timer state and unavailable storage still allows a session', () => {
  const first = fixture(), second = fixture(); first.create().set('focusMinutes', 45);
  assert.equal(second.create().getSnapshot().focusMinutes, 25);
  let now = 1800000000000, calls = 0;
  const timer = createFocusTimerController({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }, now: () => now, onComplete: () => calls++ });
  timer.set('focusMinutes', 1); timer.set('focusEnd', now + 60000); now += 60000; timer.tick(); timer.tick();
  assert.equal(calls, 1);
});

test('hook waits for account hydration and claims an expired timer once across remounts', async t => {
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('../lib/use-focus-timer.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{
    name: 'focus-hook-runtime', setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useState=v=>globalThis.focusHooks.state(v);export const useRef=v=>globalThis.focusHooks.ref(v);export const useEffect=(fn,deps)=>globalThis.focusHooks.effect(fn,deps);export const useCallback=fn=>fn;', loader: 'js' }));
    },
  }] });
  const { useFocusTimer } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  let now = 1800000000000, reads = 0, completed = 0;
  const values = new Map([[FOCUS_TIMER_STORAGE_KEY, JSON.stringify({ version: 1, focusMinutes: 1, focusRemaining: 60, focusEnd: now - 1, focusCustom: true })]]);
  const storage = { getItem(key) { reads++; return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
  const priorWindow = globalThis.window, priorDocument = globalThis.document, priorHooks = globalThis.focusHooks;
  const browser = new EventTarget(); browser.sessionStorage = storage; browser.setInterval = () => 1; browser.clearInterval = () => {};
  globalThis.window = browser; globalThis.document = new EventTarget();
  t.mock.method(Date, 'now', () => now);
  function harness() {
    let cursor = 0; const slots = [], effects = [];
    const hooks = {
      state(value) { const key = cursor++; if (!(key in slots)) slots[key] = typeof value === 'function' ? value() : value; return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; },
      ref(value) { const key = cursor++; if (!(key in slots)) slots[key] = { current: value }; return slots[key]; },
      effect(fn, deps) { const key = cursor++; if (!slots[key] || deps.some((value, i) => value !== slots[key].deps[i])) { const old = slots[key]; slots[key] = { deps }; effects.push(() => { old?.cleanup?.(); slots[key].cleanup = fn(); }); } },
    };
    return { render(ready) { cursor = 0; globalThis.focusHooks = hooks; const result = useFocusTimer(() => completed++, { ready }); effects.splice(0).forEach(fn => fn()); return result; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
  }
  try {
    let component = harness(); component.render(false);
    assert.equal(reads, 0); assert.equal(completed, 0);
    component.render(true);
    assert.equal(completed, 1); assert.equal(component.render(true).focusRemaining, 0);
    component.unmount(); component = harness(); component.render(true);
    assert.equal(completed, 1); assert.equal(component.render(true).focusEnd, 0);
    component.unmount();
  } finally {
    if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorHooks === undefined) delete globalThis.focusHooks; else globalThis.focusHooks = priorHooks;
  }
});
