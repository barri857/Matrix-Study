import {z} from 'zod';
import {idSchema} from '../app/api/_shared';
const timestamp = z.number().finite().nonnegative();
const title = z.string().max(300);
const subject = z.string().max(100);
const date = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/);
const percentage = z.number().finite().min(0).max(100);
const exam = z.object({ date, time: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/), weight: percentage, notes: z.string().max(10000) });
const httpsUrl = z.string().max(4000).url().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
});
export const workspaceSchema = z.object({
  version: z.literal(1),
  updatedAt: timestamp,
  tasks: z.array(z.object({ id: idSchema, title, date, subject, done: z.boolean() })).max(500),
  notes: z.array(z.object({ id: idSchema, title, body: z.string().max(30000), subject, updatedAt: timestamp })).max(100),
  bookmarks: z.array(z.object({ id: idSchema, title, url: httpsUrl, subject })).max(300),
  courses: z.record(z.string().max(100).refine(value => !["__proto__", "prototype", "constructor"].includes(value)), z.object({ Endterm: exam, Final: exam })).refine(value => Object.keys(value).length <= 100),
  grades: z.array(z.object({ id: idSchema, title, score: percentage, weight: percentage })).max(100),
});


