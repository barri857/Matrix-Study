import type { VisualPage } from './visual-documents';

export const MAX_PDF_AI_PAGES = 3;
const MAX_IMAGE_BASE64 = Math.floor(5 * 1024 * 1024 / 3) * 4;

export function visualRequestLabel(label: string) {
  return label.length <= 200 ? label : `${label.slice(0,160)}…${label.slice(-39)}`;
}

export function pdfBatchContext(pages: readonly VisualPage[]) {
  return JSON.stringify(pages.map(page => ({label:visualRequestLabel(page.label),text:page.text})));
}

export function pdfBatchFits(pages: readonly VisualPage[]) {
  return pages.length <= MAX_PDF_AI_PAGES &&
    pages.reduce((size,page) => size+page.data.length,0) <= MAX_IMAGE_BASE64 &&
    pdfBatchContext(pages).length <= 120000;
}

export function parsePdfBatchReply(reply: string, count: number): string[] | null {
  try {
    const decoded: unknown = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
    return Array.isArray(decoded) && decoded.length === count &&
      decoded.every(value => typeof value === 'string' && value.trim()) ? decoded : null;
  } catch {
    return null;
  }
}
