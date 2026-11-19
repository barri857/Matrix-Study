export type Task = { id: string; title: string; date: string; subject: string; done: boolean };
export type Note = { id: string; title: string; body: string; subject: string; updatedAt: number };
export type Bookmark = { id: string; title: string; url: string; subject: string };
export type Exam = { date: string; time: string; weight: number; notes: string };
export const examTypes = ['Midterm', 'Endterm', 'Final', 'Custom'] as const;
export type ExamType = typeof examTypes[number];
export type CourseExams = { Midterm: Exam; Endterm: Exam; Final: Exam; Custom: Exam & { title: string } };
export type Assessment = { id: string; title: string; score: number; weight: number };
export type Workspace = {
  version: 1;
  updatedAt: number;
  tasks: Task[];
  notes: Note[];
  bookmarks: Bookmark[];
  courses: Record<string, CourseExams>;
  grades: Assessment[];
};
export const emptyExam = (): Exam => ({ date: '', time: '', weight: 0, notes: '' });
export const emptyCourseExams = (): CourseExams => ({ Midterm: emptyExam(), Endterm: emptyExam(), Final: emptyExam(), Custom: { ...emptyExam(), title: '' } });
/** Editing one exam never replaces another exam's date, notes, or custom title. */
export function updateCourseExam(course: CourseExams | undefined, type: ExamType, patch: Partial<Exam> & { title?: string }): CourseExams {
  const exams = { ...emptyCourseExams(), ...course };
  const { title, ...fields } = patch;
  if (type === 'Custom') exams.Custom = { ...exams.Custom, ...fields, ...(title !== undefined ? { title } : {}) };
  else exams[type] = { ...exams[type], ...fields };
  return exams;
}
export const emptyWorkspace = (): Workspace => ({ version: 1, updatedAt: 0, tasks: [], notes: [], bookmarks: [], courses: {}, grades: [] });
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown, max = 300) => typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
const array = (v: unknown, max = 300): unknown[] => Array.isArray(v) ? v.slice(0, max) : [];
const id = (v: unknown) => /^[\w-]{1,100}$/.test(string(v, 100)) ? string(v, 100) : '';
const date = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(string(v, 10)) ? string(v, 10) : '';
export function safeBookmarkUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch { return null; }
}
export function readWorkspace(value: unknown): Workspace {
  const raw = object(value);
  const result = emptyWorkspace();
  result.updatedAt = num(raw.updatedAt);
  result.tasks = array(raw.tasks, 500).map(v => { const t = object(v); return { id: id(t.id), title: string(t.title), date: date(t.date), subject: string(t.subject, 100), done: t.done === true }; }).filter(v => v.id && v.title);
  result.notes = array(raw.notes, 100).map(v => { const n = object(v); return { id: id(n.id), title: string(n.title), body: string(n.body, 30000), subject: string(n.subject, 100), updatedAt: num(n.updatedAt) }; }).filter(v => v.id);
  result.bookmarks = array(raw.bookmarks, 300).map(v => { const b = object(v); return { id: id(b.id), title: string(b.title), url: safeBookmarkUrl(string(b.url, 4000)) ?? '', subject: string(b.subject, 100) }; }).filter(v => v.id && v.url);
  for (const [subject, value] of Object.entries(object(raw.courses)).slice(0, 100)) {
    if (['__proto__', 'prototype', 'constructor'].includes(subject)) continue;
    const course = object(value);
    const exam = (v: unknown): Exam => { const e = object(v); return { date: date(e.date), time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(string(e.time, 5)) ? string(e.time, 5) : '', weight: num(e.weight, 100), notes: string(e.notes, 10000) }; };
    result.courses[subject.slice(0, 100)] = { Midterm: exam(course.Midterm), Endterm: exam(course.Endterm), Final: exam(course.Final), Custom: { ...exam(course.Custom), title: string(object(course.Custom).title, 160) } };
  }
  result.grades = array(raw.grades, 100).map(v => { const g = object(v); return { id: id(g.id), title: string(g.title), score: num(g.score, 100), weight: num(g.weight, 100) }; }).filter(v => v.id);
  return result;
}
export function gradeSummary(rows: Assessment[]) {
  const weight = rows.reduce((sum, row) => sum + row.weight, 0);
  const points = rows.reduce((sum, row) => sum + row.score * row.weight / 100, 0);
  return { weight, points, average: weight > 0 ? points / weight * 100 : 0, valid: Math.abs(weight - 100) < 0.01 };
}

/** Keepalive has a shared browser budget of about 64 KiB; larger drafts remain in the local cache. */
export function pendingWorkspaceBody(data: Workspace, dirty: boolean, cloud: boolean, submittedAt: number): string | null {
  if (!dirty || !cloud || data.updatedAt <= submittedAt) return null;
  const body = JSON.stringify({ data });
  return new TextEncoder().encode(body).byteLength <= 60000 ? body : null;
}

export function hasWorkspaceContent(data: Workspace): boolean {
  return Boolean(data.tasks.length || data.notes.length || data.bookmarks.length || Object.keys(data.courses).length || data.grades.length);
}

/** Explicit guest import preserves current records and reconstructs only allowed data. */
export function mergeGuestWorkspace(current: Workspace, guest: Workspace, createId = () => crypto.randomUUID()): Workspace {
  const own = readWorkspace(current);
  const incoming = readWorkspace(guest);
  const taskKey = (task: Task) => JSON.stringify([task.title, task.date, task.subject]);
  const noteKey = (note: Note) => JSON.stringify([note.title, note.body, note.subject]);
  const bookmarkKey = (bookmark: Bookmark) => JSON.stringify([bookmark.url, bookmark.subject]);
  const existingTasks = new Set(own.tasks.map(taskKey));
  const existingNotes = new Set(own.notes.map(noteKey));
  const existingBookmarks = new Set(own.bookmarks.map(bookmarkKey));
  const tasks = incoming.tasks.filter(task => !existingTasks.has(taskKey(task))).map(task => ({ ...task, id: createId() }));
  const notes = incoming.notes.filter(note => !existingNotes.has(noteKey(note))).map(note => ({ ...note, id: createId() }));
  const bookmarks = incoming.bookmarks.filter(bookmark => !existingBookmarks.has(bookmarkKey(bookmark))).map(bookmark => ({ ...bookmark, id: createId() }));
  const result: Workspace = {
    ...own,
    tasks: [...own.tasks, ...tasks],
    notes: [...own.notes, ...notes],
    bookmarks: [...own.bookmarks, ...bookmarks],
    courses: { ...incoming.courses, ...own.courses },
    grades: own.grades.length ? own.grades : incoming.grades.map(grade => ({ ...grade, id: createId() })),
  };
  if (result.tasks.length > 500 || result.notes.length > 100 || result.bookmarks.length > 300 || Object.keys(result.courses).length > 100) {
    throw new Error('There is not enough room to import all guest work. Remove old items and try again.');
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 280000) {
    throw new Error('The combined workspace is too large. Shorten long notes or remove old items before importing.');
  }
  return result;
}
