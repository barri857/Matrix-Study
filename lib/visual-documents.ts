import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { MAX_GUIDE_IMAGE_DATA, MAX_GUIDE_IMAGE_EDGE, type GuideImage } from './study';

export type VisualPage = {
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  label: string;
  text: string;
  width: number;
  height: number;
  warnings?: string[];
};

export const MAX_VISUAL_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_VISUAL_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_VISUAL_PAGES = 200;
export const MAX_VISUAL_EDGE = 2000;
export const MAX_VISUAL_PIXELS = 4_000_000;
const MAX_SOURCE_IMAGE_PIXELS = 80_000_000;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

function stopped() { return new DOMException('Reading stopped.', 'AbortError'); }
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw stopped(); }

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(stopped()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export function visualDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('This page has invalid dimensions.');
  const scale = Math.min(1, MAX_VISUAL_EDGE / width, MAX_VISUAL_EDGE / height, Math.sqrt(MAX_VISUAL_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { alpha: false });
  if (!context) throw new Error('Your browser could not prepare a document preview. Try another browser.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  return { element, context };
}

function blobFromCanvas(element: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => element.toBlob(blob => blob ? resolve(blob) : reject(new Error('This page could not be converted into an image.')), type, quality));
}

async function base64(blob: Blob, signal?: AbortSignal) {
  const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}

// Preserve sharp text/diagrams losslessly when possible, then use bounded JPEG.
async function encode(element: HTMLCanvasElement, signal?: AbortSignal): Promise<Pick<VisualPage, 'data' | 'mimeType'>> {
  checkSignal(signal);
  let blob = await abortable(blobFromCanvas(element, 'image/png'), signal);
  if (blob.size <= MAX_VISUAL_IMAGE_BYTES) return { data: await base64(blob, signal), mimeType: 'image/png' };
  for (const quality of [0.9, 0.82, 0.74, 0.64]) {
    checkSignal(signal);
    blob = await abortable(blobFromCanvas(element, 'image/jpeg', quality), signal);
    if (blob.size <= MAX_VISUAL_IMAGE_BYTES) return { data: await base64(blob, signal), mimeType: 'image/jpeg' };
  }
  throw new Error('This image is too detailed to send at a readable size. Crop it into smaller sections and add them separately.');
}

async function pageText(page: PDFPageProxy) {
  const content = await page.getTextContent();
  const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
  if (text.length > 100000) throw new Error('A PDF page contains more than 100,000 characters. Split or simplify that page before importing.');
  return text;
}

async function* renderPdf(file: File, signal?: AbortSignal): AsyncGenerator<VisualPage> {
  const pdf = await import('pdfjs-dist');
  checkSignal(signal);
  pdf.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const loading = pdf.getDocument({
    data: new Uint8Array(await abortable(file.arrayBuffer(), signal)),
    cMapUrl: '/pdf-support/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdf-support/standard_fonts/', wasmUrl: '/pdf-support/wasm/', iccUrl: '/pdf-support/iccs/',
    useSystemFonts: true, canvasMaxAreaInBytes: 16_000_000,
    stopAtErrors: true, disableAutoFetch: true, disableStream: true,
  });
  let active: RenderTask | undefined;
  let destroying: Promise<void> | undefined;
  const destroy = () => destroying ||= loading.destroy();
  const abort = () => { active?.cancel(); void destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkSignal(signal);
    const doc = await abortable(loading.promise, signal);
    if (doc.numPages > MAX_VISUAL_PAGES) throw new Error('Please split PDFs longer than 200 pages. No pages from this file were read.');
    for (let index = 1; index <= doc.numPages; index++) {
      checkSignal(signal);
      const page = await abortable(doc.getPage(index), signal);
      let surface: ReturnType<typeof canvas> | undefined;
      let result: VisualPage;
      try {
        // Render at 2x PDF points unless the edge/pixel bounds require less.
        const natural = page.getViewport({ scale: 2 });
        const size = visualDimensions(natural.width, natural.height);
        const viewport = page.getViewport({ scale: 2 * Math.min(size.width / natural.width, size.height / natural.height) });
        const width = Math.max(1, Math.floor(viewport.width)), height = Math.max(1, Math.floor(viewport.height));
        surface = canvas(width, height);
        active = page.render({ canvas: surface.element, canvasContext: surface.context, viewport, background: '#ffffff', annotationMode: pdf.AnnotationMode.ENABLE });
        await abortable(active.promise, signal);
        active = undefined;
        const text = await abortable(pageText(page), signal);
        const encoded = await encode(surface.element, signal);
        result = { ...encoded, label: `${file.name} · page ${index} of ${doc.numPages}`, text, width, height };
      } finally {
        active?.cancel(); active = undefined;
        if (surface) { surface.element.width = 0; surface.element.height = 0; }
        page.cleanup();
      }
      checkSignal(signal);
      // The page canvas is released before the caller waits for its AI request.
      yield result;
    }
  } catch (error) {
    if (signal?.aborted) throw stopped();
    if (error && typeof error === 'object' && 'name' in error && error.name === 'PasswordException') throw new Error('This PDF is password protected. Save an unlocked copy before importing it.');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    active?.cancel();
    await destroy().catch(() => {});
  }
}

async function htmlImage(file: File, signal?: AbortSignal): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  const url = URL.createObjectURL(file), image = new Image();
  image.decoding = 'async';
  try {
    const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This image could not be opened. Save a new JPG, PNG or WebP copy.')); image.src = url; });
    await abortable(loaded, signal);
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => { image.src = ''; URL.revokeObjectURL(url); } };
  } catch (error) { image.src = ''; URL.revokeObjectURL(url); throw error; }
}

async function decodeImage(file: File, signal?: AbortSignal) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let image: { source: CanvasImageSource; width: number; height: number; close: () => void };
  if (typeof createImageBitmap === 'function') {
    // from-image honors phone-camera EXIF orientation; animated Blob input uses frame 1.
    const pending = createImageBitmap(file, { imageOrientation: 'from-image' });
    let bitmap: ImageBitmap;
    try { bitmap = await abortable(pending, signal); }
    catch (error) {
      if (signal?.aborted) { void pending.then(value => value.close(), () => {}); throw stopped(); }
      throw new Error('This image could not be opened. Save a new JPG, PNG or WebP copy.');
    }
    image = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } else {
    if (extension === 'gif') throw new Error('This browser cannot read a GIF frame reliably. Save it as PNG or use a current browser.');
    image = await htmlImage(file, signal);
  }
  return image;
}

async function renderImage(file: File, signal?: AbortSignal): Promise<VisualPage> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const image = await decodeImage(file, signal);
  let surface: ReturnType<typeof canvas> | undefined;
  try {
    checkSignal(signal);
    if (image.width * image.height > MAX_SOURCE_IMAGE_PIXELS) throw new Error('This photo is larger than 80 megapixels. Resize or crop it before importing.');
    const size = visualDimensions(image.width, image.height);
    surface = canvas(size.width, size.height);
    surface.context.drawImage(image.source, 0, 0, size.width, size.height);
    const encoded = await encode(surface.element, signal);
    return { ...encoded, label: `${file.name}${extension === 'gif' ? ' · first frame' : ''}`, text: '', ...size,
      ...(extension === 'gif' ? { warnings: ['Only the first GIF frame is read. Add separate images for other frames.'] } : {}),
    };
  } finally {
    image.close();
    if (surface) { surface.element.width = 0; surface.element.height = 0; }
  }
}

/** Prepare a deliberately attached image for storage inside the saved guide. */
export async function prepareGuideImage(file: File): Promise<GuideImage> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('Choose a JPG, PNG, WebP, GIF or BMP image.');
  if (!file.size || file.size > MAX_VISUAL_FILE_BYTES) throw new Error('Choose a nonempty image up to 12 MB.');
  const image = await decodeImage(file);
  try {
    if (image.width * image.height > MAX_SOURCE_IMAGE_PIXELS) {
      throw new Error('This photo is larger than 80 megapixels. Resize or crop it before importing.');
    }
    let scale = Math.min(1, MAX_GUIDE_IMAGE_EDGE / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 6; attempt++, scale *= 0.77) {
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const surface = canvas(width, height);
      try {
        surface.context.drawImage(image.source, 0, 0, width, height);
        for (const quality of [0.9, 0.76, 0.63]) {
          const blob = await blobFromCanvas(surface.element, 'image/jpeg', quality);
          if (Math.ceil(blob.size / 3) * 4 <= MAX_GUIDE_IMAGE_DATA) {
            const name = file.name.replace(/[\r\n]/g, ' ').trim().slice(0, 160) || 'Guide image';
            return { id: crypto.randomUUID(), name, data: await base64(blob), width, height };
          }
        }
      } finally {
        surface.element.width = 0;
        surface.element.height = 0;
      }
    }
    throw new Error('This image is too large for the guide. Crop or resize it and try again.');
  } finally {
    image.close();
  }
}

/** Local-only rasterization: this function never uploads the source or follows image links. */
export async function* renderVisualDocument(file: File, options: { signal?: AbortSignal } = {}): AsyncGenerator<VisualPage> {
  checkSignal(options.signal);
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_VISUAL_FILE_BYTES) throw new Error('This file is larger than 12 MB. Choose a smaller file.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (extension !== 'pdf' && !IMAGE_EXTENSIONS.has(extension)) throw new Error('Visual reading supports PDF, JPG, PNG, WebP, GIF and BMP files.');
  if (typeof document === 'undefined') throw new Error('Visual documents are prepared in your browser.');
  if (extension === 'pdf') { yield* renderPdf(file, options.signal); return; }
  const result = await renderImage(file, options.signal);
  checkSignal(options.signal);
  yield result;
}
