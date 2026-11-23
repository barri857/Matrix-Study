import { renderVisualDocument, type VisualPage } from './visual-documents';

/** Repaint the slide independently of the SVG capture and read the resulting PDF page. */
export async function recoverPowerPointSlide(
  element: HTMLElement, width: number, height: number, scale: number, signal: AbortSignal,
): Promise<VisualPage> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  signal.throwIfAborted();
  let surface: HTMLCanvasElement | undefined;
  const cloneState: { frame?: Element | null } = {};
  try {
    surface = await html2canvas(element, {
      width, height, scale, backgroundColor: '#fff', logging: false, imageTimeout: 8000,
      allowTaint: false, useCORS: false,
      ignoreElements: node => !node.contains(element) && !element.contains(node) &&
        !['HEAD', 'LINK', 'STYLE'].includes(node.tagName),
      onclone: (clonedDocument, clone) => {
        cloneState.frame = clonedDocument.defaultView?.frameElement;
        signal.throwIfAborted();
        if (clone.parentElement) clone.parentElement.style.left = '0';
      },
    });
    signal.throwIfAborted();
    const pdf = new jsPDF({
      unit: 'pt', format: [surface.width, surface.height],
      orientation: surface.width >= surface.height ? 'landscape' : 'portrait', compress: true,
    });
    pdf.addImage(surface.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, surface.width, surface.height);
    const file = new File([pdf.output('arraybuffer')], 'Recovered slide.pdf', { type: 'application/pdf' });
    for await (const page of renderVisualDocument(file, { signal })) return page;
    throw new Error('The recovered PDF contained no page.');
  } finally {
    cloneState.frame?.remove();
    if (surface) { surface.width = 0; surface.height = 0; }
  }
}
