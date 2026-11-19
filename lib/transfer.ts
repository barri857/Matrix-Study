import { z } from 'zod';
import { validateKit, type Kit } from './study';
import { emptyWorkspace, mergeGuestWorkspace, readWorkspace, type Workspace } from './workspace';

export const TRANSFER_MAX_BYTES = 12 * 1024 * 1024;
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const timestamp = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const label = z.string().max(300);
const subject = z.string().max(100);
const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/);
const percentage = z.number().finite().min(0).max(100);
const exam = z.object({ date, time: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/), weight: percentage, notes: z.string().max(10000) });
const workspaceSchema = z.object({
  version: z.literal(1), updatedAt: timestamp,
  tasks: z.array(z.object({ id: safeId, title: label, date, subject, done: z.boolean() })).max(500),
  notes: z.array(z.object({ id: safeId, title: label, body: z.string().max(30000), subject, updatedAt: timestamp })).max(100),
  bookmarks: z.array(z.object({ id: safeId, title: label, subject, url: z.string().max(4000).url().refine(value => {
    const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password;
  }) })).max(300),
  courses: z.record(z.string().max(100).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value)), z.object({ Endterm: exam, Final: exam })).refine(value => Object.keys(value).length <= 100),
  grades: z.array(z.object({ id: safeId, title: label, score: percentage, weight: percentage })).max(100),
});

export type TransferBundle = { format: 'matrix-workspace'; version: 1; exportedAt: number; kits: Kit[]; workspace: Workspace };
export type TransferOptions = { replaceCoursePlans?: boolean; replaceGrades?: boolean };
export type TransferPlan = { kits: Kit[]; workspace: Workspace; skippedKits: number; keptCoursePlans: number; keptGradeRows: number };

/** Rebuilds known content fields; account identity and AI connection fields are never copied. */
export function safeTransferWorkspace(value: unknown): Workspace {
  const checked = workspaceSchema.safeParse(value);
  if (!checked.success) throw new Error('This workspace contains invalid notes, plans, links, or grades. Export it again from Matrix.');
  const data = readWorkspace(checked.data);
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 280000) throw new Error('This workspace is too large to import. Keep notes and plans under 280 KB.');
  return data;
}

export function createTransferBundle(kits: Kit[], workspace: Workspace = emptyWorkspace(), now = Date.now()): TransferBundle {
  if (kits.length > 100) throw new Error('A workspace transfer supports up to 100 study kits.');
  const safeKits = kits.map(kit => validateKit(kit));
  const bundle: TransferBundle = { format: 'matrix-workspace', version: 1, exportedAt: timestamp.parse(now), kits: safeKits, workspace: safeTransferWorkspace(workspace) };
  if (new TextEncoder().encode(JSON.stringify(bundle)).byteLength > TRANSFER_MAX_BYTES) throw new Error('This export is larger than 12 MB. Export large study kits individually first.');
  return bundle;
}

export function parseTransferBundle(text: string): TransferBundle {
  if (new TextEncoder().encode(text).byteLength > TRANSFER_MAX_BYTES) throw new Error('Choose a Matrix workspace file smaller than 12 MB.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose an exported Matrix workspace file.'); }
  const header = z.object({ format: z.literal('matrix-workspace'), version: z.literal(1), exportedAt: timestamp, kits: z.array(z.unknown()).max(100), workspace: z.unknown() }).safeParse(raw);
  if (!header.success) throw new Error('This is not a supported Matrix workspace export. Individual study kits use the separate kit import.');
  return createTransferBundle(header.data.kits.map(kit => validateKit(kit)), safeTransferWorkspace(header.data.workspace), header.data.exportedAt);
}

function kitFingerprint(kit: Kit): string {
  // IDs and save timestamps change when copied; actual study content and progress do not.
  return JSON.stringify({ ...kit, id: '', updatedAt: 0, cards: kit.cards.map(card => ({ ...card, id: '' })), questions: kit.questions.map(question => ({ ...question, id: '' })) });
}

export function planTransferImport(currentKits: Kit[], currentWorkspace: Workspace, bundle: TransferBundle, options: TransferOptions = {}, createId: () => string = () => crypto.randomUUID(), now = Date.now()): TransferPlan {
  const own = safeTransferWorkspace(currentWorkspace);
  const incoming = createTransferBundle(bundle.kits, bundle.workspace, bundle.exportedAt);
  const fingerprints = new Set(currentKits.map(kit => kitFingerprint(validateKit(kit))));
  const kits: Kit[] = [];
  for (const kit of incoming.kits) {
    const fingerprint = kitFingerprint(kit);
    if (fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    kits.push(validateKit({ ...kit, id: createId(), updatedAt: now }));
  }
  if (currentKits.length + kits.length > 100) throw new Error(`This import would exceed your 100-kit library limit. Make room for ${kits.length} imported kits first.`);
  let workspace = mergeGuestWorkspace(own, incoming.workspace, createId);
  const collisions = Object.keys(incoming.workspace.courses).filter(key => Object.hasOwn(own.courses, key) && JSON.stringify(own.courses[key]) !== JSON.stringify(incoming.workspace.courses[key]));
  if (options.replaceCoursePlans) workspace.courses = { ...own.courses, ...incoming.workspace.courses };
  if (options.replaceGrades) workspace.grades = incoming.workspace.grades.map(row => ({ ...row, id: createId() }));
  workspace.updatedAt = Math.max(now, own.updatedAt + 1);
  workspace = safeTransferWorkspace(workspace);
  return { kits, workspace, skippedKits: incoming.kits.length - kits.length, keptCoursePlans: options.replaceCoursePlans ? 0 : collisions.length, keptGradeRows: !options.replaceGrades && own.grades.length ? incoming.workspace.grades.length : 0 };
}

export function transferCounts(bundle: TransferBundle) {
  return { kits: bundle.kits.length, notes: bundle.workspace.notes.length, tasks: bundle.workspace.tasks.length, resources: bundle.workspace.bookmarks.length, courses: Object.keys(bundle.workspace.courses).length, grades: bundle.workspace.grades.length };
}
