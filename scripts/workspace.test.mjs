import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, emptyExam, emptyCourseExams, readWorkspace, updateCourseExam, gradeSummary, hasWorkspaceContent, mergeGuestWorkspace, pendingWorkspaceBody, safeBookmarkUrl } from '../lib/workspace.ts';

test('bookmarks accept only credential-free HTTPS URLs', () => {
  assert.equal(safeBookmarkUrl('https://example.com/lecture?q=cell'), 'https://example.com/lecture?q=cell');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'file:///tmp/a', 'https://user:secret@example.com', 'not-a-url']) assert.equal(safeBookmarkUrl(url), null);
});

test('workspace reader removes unrecognized fields and unsafe links', () => {
  const input = { ...emptyWorkspace(), apiKey: 'never-store', bookmarks: [{ id: 'a', title: 'Bad', subject: 'General', url: 'javascript:alert(1)' }], notes: [{ id: 'n1', title: 'Lecture', body: 'My ideas', subject: 'Biology', updatedAt: 2, secret: 'excluded' }] };
  const result = readWorkspace(input);
  assert.equal(result.bookmarks.length, 0);
  assert.equal(result.notes.length, 1);
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
  assert.equal(Object.hasOwn(result.notes[0], 'secret'), false);
});

test('workspace reader blocks prototype keys in course records', () => {
  const input = JSON.parse('{"courses":{"__proto__":{"polluted":true},"Physics":{"Final":{"date":"2026-12-01","time":"14:30","weight":40,"notes":"Review motion"}}}}');
  const result = readWorkspace(input);
  assert.equal(Object.hasOwn(result.courses, '__proto__'), false);
  assert.equal(result.courses.Physics.Final.weight, 40);
  assert.equal(result.courses.Physics.Endterm.date, '');
});

test('legacy exam plans retain Endterm and Final dates while new exam types start empty', () => {
  const old = { ...emptyWorkspace(), courses: { Algorithms: { Endterm: { ...emptyExam(), date: '2026-11-25', weight: 30 }, Final: { ...emptyExam(), date: '2026-12-12', time: '09:30', notes: 'Chapters 1–10' } } } };
  const restored = readWorkspace(old).courses.Algorithms;
  assert.deepEqual(restored.Endterm, old.courses.Algorithms.Endterm);
  assert.deepEqual(restored.Final, old.courses.Algorithms.Final);
  assert.deepEqual(restored.Midterm, emptyExam());
  assert.deepEqual(restored.Custom, { ...emptyExam(), title: '' });
});

test('editing exam types keeps independent dates and the custom title across serialization', () => {
  const original = emptyCourseExams();
  let plans = updateCourseExam(original, 'Endterm', { date: '2026-11-25', notes: 'Graphs' });
  plans = updateCourseExam(plans, 'Final', { date: '2026-12-12', weight: 40 });
  plans = updateCourseExam(plans, 'Midterm', { date: '2026-10-15', time: '10:30' });
  plans = updateCourseExam(plans, 'Custom', { title: 'Algorithm lab defense', date: '2026-11-22', notes: 'Bring code' });
  plans = updateCourseExam(plans, 'Midterm', { time: '11:00' });
  assert.equal(original.Endterm.date, '');
  const restored = readWorkspace(JSON.parse(JSON.stringify({ ...emptyWorkspace(), courses: { Algorithms: plans } }))).courses.Algorithms;
  assert.equal(restored.Endterm.date, '2026-11-25');
  assert.equal(restored.Final.date, '2026-12-12');
  assert.equal(restored.Midterm.date, '2026-10-15');
  assert.equal(restored.Midterm.time, '11:00');
  assert.equal(restored.Custom.date, '2026-11-22');
  assert.equal(restored.Custom.title, 'Algorithm lab defense');
  assert.equal(restored.Custom.notes, 'Bring code');
});

test('new exam fields are sanitized with the same limits as existing plans', () => {
  const plans = { ...emptyCourseExams(), Midterm: { ...emptyExam(), time: '99:99' }, Custom: { ...emptyExam(), title: 'x'.repeat(200), secret: 'excluded' } };
  const restored = readWorkspace({ courses: { Algorithms: plans } }).courses.Algorithms;
  assert.equal(restored.Midterm.time, '');
  assert.equal(restored.Custom.title.length, 160);
  assert.equal(Object.hasOwn(restored.Custom, 'secret'), false);
});

test('weighted calculation distinguishes partial average from course points', () => {
  const partial = gradeSummary([{ id: '1', title: 'Endterm', score: 80, weight: 25 }]);
  assert.equal(partial.points, 20);
  assert.equal(partial.average, 80);
  assert.equal(partial.valid, false);
  const full = gradeSummary([{ id: '1', title: 'Endterm', score: 80, weight: 25 }, { id: '2', title: 'Final', score: 60, weight: 75 }]);
  assert.equal(full.average, 65);
  assert.equal(full.points, 65);
  assert.equal(full.valid, true);
  assert.equal(gradeSummary([]).average, 0);
  assert.equal(gradeSummary([{ id: '1', title: 'A', score: 80, weight: 70 }, { id: '2', title: 'B', score: 80, weight: 70 }]).valid, false);
});

test('navigation save sends only a pending newer authenticated snapshot', () => {
  const data = { ...emptyWorkspace(), updatedAt: 10 };
  assert.equal(JSON.parse(pendingWorkspaceBody(data, true, true, 9)).data.updatedAt, 10);
  assert.equal(pendingWorkspaceBody(data, false, true, 0), null);
  assert.equal(pendingWorkspaceBody(data, true, false, 0), null);
  assert.equal(pendingWorkspaceBody(data, true, true, 10), null);
  assert.equal(pendingWorkspaceBody(data, true, true, 11), null);
});

test('navigation save applies the browser keepalive limit to UTF-8 bytes', () => {
  const data = { ...emptyWorkspace(), updatedAt: 1, notes: [{ id: 'a', title: 'Draft', body: '学'.repeat(21000), subject: '', updatedAt: 1 }] };
  assert.ok(JSON.stringify(data).length < 60000);
  assert.equal(pendingWorkspaceBody(data, true, true, 0), null);
});

test('explicit guest import assigns fresh IDs and preserves account plans and grades', () => {
  const emptyExam = { date: '', time: '', weight: 0, notes: '' };
  const own = { ...emptyWorkspace(), notes: [{ id: 'own-note', title: 'Existing', body: 'Keep this', subject: '', updatedAt: 1 }], courses: { Biology: { Endterm: { ...emptyExam, weight: 30 }, Final: emptyExam } }, grades: [{ id: 'own-grade', title: 'My result', score: 80, weight: 100 }] };
  const guest = { ...emptyWorkspace(), tasks: [{ id: 'guest-task', title: 'Read', subject: 'Biology', date: '', done: false }], notes: [{ id: 'guest-note', title: 'New note', body: 'Guest content', subject: '', updatedAt: 2 }], bookmarks: [{ id: 'guest-link', title: 'Resource', subject: '', url: 'https://example.com/' }], courses: { Biology: { Endterm: { ...emptyExam, weight: 99 }, Final: emptyExam }, Physics: { Endterm: emptyExam, Final: { ...emptyExam, weight: 40 } } }, grades: [{ id: 'guest-grade', title: 'Old result', score: 10, weight: 100 }], apiKey: 'excluded' };
  let next = 0;
  const combined = mergeGuestWorkspace(own, guest, () => `fresh-${++next}`);
  assert.equal(combined.notes[0].id, 'own-note');
  assert.equal(combined.notes[1].id, 'fresh-2');
  assert.equal(combined.tasks[0].id, 'fresh-1');
  assert.equal(combined.bookmarks[0].id, 'fresh-3');
  assert.equal(combined.courses.Biology.Endterm.weight, 30);
  assert.equal(combined.courses.Physics.Final.weight, 40);
  assert.equal(combined.grades[0].id, 'own-grade');
  assert.equal(Object.hasOwn(combined, 'apiKey'), false);
  assert.equal(hasWorkspaceContent(combined), true);
  assert.equal(hasWorkspaceContent(emptyWorkspace()), false);
  const again = mergeGuestWorkspace(combined, guest, () => `fresh-${++next}`);
  assert.equal(again.tasks.length, 1);
  assert.equal(again.notes.length, 2);
  assert.equal(again.bookmarks.length, 1);
});
