import type { jsPDF } from 'jspdf';
import type { Token, Tokens } from 'marked';

export type GuideDownloadFormat = 'pdf' | 'md';

type GuideImage = { name: string; data: string; width: number; height: number };
type GuideDocument = { title: string; guide: string; images?: readonly GuideImage[] };
type TextStyle = { size?: number; bold?: boolean; indent?: number; after?: number; literal?: boolean };

const font = 'Matrix Sans';
const margin = 44;
const ink = '#1b2637';
const muted = '#46556b';
const border = '#c7d2df';

async function fontData(file: string) {
  const response = await fetch(`/guide-fonts/${file}`);
  if (!response.ok) throw new Error('The PDF font could not be loaded. Please try again.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function inlineText(tokens: Token[], depth = 0): string {
  if (depth > 30) return '';
  return tokens.map(token => {
    if (token.type === 'br') return '\n';
    if (token.type === 'html') return '';
    if ('tokens' in token && token.tokens?.length) return inlineText(token.tokens, depth + 1);
    return 'text' in token && typeof token.text === 'string' ? token.text : '';
  }).join('');
}

class GuidePdfLayout {
  private cursor = margin;
  private readonly pdf: jsPDF;
  private readonly width: number;
  private readonly bottom: number;

  constructor(pdf: jsPDF) {
    this.pdf = pdf;
    this.width = pdf.internal.pageSize.getWidth() - margin * 2;
    this.bottom = pdf.internal.pageSize.getHeight() - margin - 10;
  }

  private nextPage() {
    this.pdf.addPage();
    this.cursor = margin;
  }

  private fit(height: number) {
    if (this.cursor + height > this.bottom && this.cursor > margin) this.nextPage();
  }

  private typography(size: number, bold = false, color = ink) {
    this.pdf.setFont(font, bold ? 'bold' : 'normal');
    this.pdf.setFontSize(size).setTextColor(color);
  }

  write(raw: string, style: TextStyle = {}, bullet?: string) {
    const { size = 11, bold = false, indent = 0, after = 8, literal = false } = style;
    const text = literal ? raw.replace(/\t/g, '    ') : raw.replace(/[^\S\n]+/g, ' ').trim();
    if (!text) return;
    const leading = size * 1.38;
    const x = margin + indent + (bullet ? 17 : 0);
    this.typography(size, bold);
    const lines: string[] = this.pdf.splitTextToSize(text, this.width + margin - x);
    this.fit(leading * Math.min(lines.length + (bold ? 1 : 0), 3));
    if (bullet) this.pdf.text(bullet, x - 6, this.cursor + size, { align: 'right' });
    for (const line of lines) {
      this.fit(leading);
      this.pdf.text(line, x, this.cursor + size);
      this.cursor += leading;
    }
    this.cursor += after;
  }

  private rule(indent = 0) {
    this.fit(15);
    this.pdf.setDrawColor(border).setLineWidth(0.6).line(margin + indent, this.cursor + 4, margin + this.width, this.cursor + 4);
    this.cursor += 15;
  }

  blocks(tokens: Token[], indent = 0, depth = 0, bullet?: string) {
    if (depth > 30) return;
    for (const token of tokens) {
      if (token.type === 'space' || token.type === 'def' || token.type === 'html') continue;
      switch (token.type) {
        case 'heading': {
          const heading = token as Tokens.Heading;
          const size = heading.depth === 1 ? 19 : heading.depth === 2 ? 16 : 12;
          this.cursor += 5;
          this.write(inlineText(heading.tokens), { size, bold: true, indent, after: 5 }, bullet);
          break;
        }
        case 'list': {
          const list = token as Tokens.List;
          list.items.forEach((item, index) => {
            const marker = list.ordered ? `${(list.start || 1) + index}.` : '•';
            const checkbox = item.task ? (item.checked ? '[x] ' : '[ ] ') : '';
            this.blocks(item.tokens, Math.min(95, indent + 14), depth + 1, marker + checkbox);
          });
          break;
        }
        case 'blockquote':
          this.blocks((token as Tokens.Blockquote).tokens, Math.min(95, indent + 16), depth + 1, bullet);
          break;
        case 'code':
          this.write((token as Tokens.Code).text, { literal: true, size: 9, indent: indent + 12 }, bullet);
          break;
        case 'table':
          this.table(token as Tokens.Table, indent);
          break;
        case 'hr':
          this.rule(indent);
          break;
        default:
          this.write(inlineText([token]), { indent, after: bullet ? 3 : 8 }, bullet);
      }
      bullet = undefined;
    }
  }

  private table(table: Tokens.Table, indent: number) {
    const x = margin + indent;
    const width = this.width - indent;
    const columnCount = table.header.length;
    if (!columnCount) return;
    const columnWidth = width / columnCount;
    if (columnWidth < 55) {
      for (const row of table.rows) {
        row.forEach((cell, i) => this.write(`${inlineText(table.header[i].tokens)}: ${inlineText(cell.tokens)}`, { indent, after: 3 }));
        this.cursor += 8;
      }
      if (!table.rows.length) this.write(table.header.map(cell => inlineText(cell.tokens)).join(' · '), { indent });
      return;
    }
    const size = 10;
    const leading = 13;
    const padding = 7;
    const measure = (cells: Tokens.TableCell[], header: boolean): string[][] => {
      this.typography(size, header);
      return cells.map(cell => this.pdf.splitTextToSize(inlineText(cell.tokens), columnWidth - padding * 2));
    };
    const headingLines = measure(table.header, true);
    const headingCount = Math.max(1, ...headingLines.map(lines => lines.length));
    const height = (lineCount: number) => lineCount * leading + padding * 2;
    const draw = (cells: string[][], start: number, count: number, header: boolean) => {
      const rowHeight = height(count);
      const background = header ? '#eaf1f7' : '#ffffff';
      this.pdf.setDrawColor(border).setLineWidth(0.5);
      this.typography(size, header);
      for (let i = 0; i < columnCount; i++) {
        const left = x + i * columnWidth;
        this.pdf.setFillColor(background).rect(left, this.cursor, columnWidth, rowHeight, 'FD');
        const align = table.align[i] || 'left';
        const textX = align === 'center' ? left + columnWidth / 2 : align === 'right' ? left + columnWidth - padding : left + padding;
        (cells[i] || []).slice(start, start + count).forEach((line, lineIndex) => {
          this.pdf.text(line, textX, this.cursor + padding + size + lineIndex * leading, { align });
        });
      }
      this.cursor += rowHeight;
    };
    const repeatHeader = headingCount <= 6;
    if (repeatHeader) this.fit(height(headingCount) + (table.rows.length ? height(1) : 0));
    const rows = [{ cells: headingLines, header: true }, ...table.rows.map(row => ({ cells: measure(row, false), header: false }))];
    for (const { cells, header } of rows) {
      const lineCount = Math.max(1, ...cells.map(lines => lines.length));
      for (let offset = 0; offset < lineCount;) {
        if (this.cursor + height(1) > this.bottom) {
          this.nextPage();
          if (!header && repeatHeader) draw(headingLines, 0, headingCount, true);
        }
        const available = Math.floor((this.bottom - this.cursor - padding * 2) / leading);
        const count = Math.min(lineCount - offset, available);
        draw(cells, offset, count, header);
        offset += count;
      }
    }
    this.cursor += 12;
  }

  images(images: readonly GuideImage[]) {
    for (const image of images) {
      const scale = Math.min(1, this.width / image.width, 450 / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      if (!Number.isFinite(width + height) || width <= 0 || height <= 0) continue;
      this.fit(height + 35);
      try {
        this.pdf.addImage(`data:image/jpeg;base64,${image.data}`, 'JPEG', margin, this.cursor, width, height);
        this.cursor += height + 3;
      } catch {
        // Preserve the caption if an archived image cannot be decoded.
      }
      this.write(image.name, { size: 10, after: 13 });
    }
  }

  finish() {
    const count = this.pdf.getNumberOfPages();
    const y = this.pdf.internal.pageSize.getHeight() - 24;
    for (let page = 1; page <= count; page++) {
      this.pdf.setPage(page);
      this.typography(9, false, muted);
      this.pdf.text(`${page} / ${count}`, margin + this.width, y, { align: 'right' });
    }
    return this.pdf.output('blob');
  }
}

export async function createGuidePdf({ title, guide, images = [] }: GuideDocument) {
  const [{ jsPDF }, { marked }, regular, bold] = await Promise.all([
    import('jspdf'), import('marked'), fontData('DejaVuSans.ttf'), fontData('DejaVuSans-Bold.ttf'),
  ]);
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS('Matrix-Regular.ttf', regular).addFont('Matrix-Regular.ttf', font, 'normal');
  pdf.addFileToVFS('Matrix-Bold.ttf', bold).addFont('Matrix-Bold.ttf', font, 'bold');
  pdf.setProperties({ title });
  const tokens = marked.lexer(guide, { gfm: true });
  const first = tokens[0];
  if (first?.type === 'heading' && inlineText((first as Tokens.Heading).tokens).trim() === title.trim()) tokens.shift();
  const layout = new GuidePdfLayout(pdf);
  layout.write(title, { size: 23, bold: true, after: 14 });
  layout.blocks(tokens);
  layout.images(images);
  return layout.finish();
}

function guideMarkdown(guide: string, images: readonly GuideImage[]) {
  const imageBlocks = images.map(({ name, data }) => {
    const caption = name.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
    return `${caption}\n\n![${caption}](data:image/jpeg;base64,${data})`;
  });
  return `${[guide.trimEnd(), ...imageBlocks].filter(Boolean).join('\n\n')}\n`;
}

export async function downloadGuide({ title, guide, images = [], format = 'pdf' }: GuideDocument & { format?: GuideDownloadFormat }) {
  const blob = format === 'md'
    ? new Blob([guideMarkdown(guide, images)], { type: 'text/markdown;charset=utf-8' })
    : await createGuidePdf({ title, guide, images });
  const safeTitle = Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().replace(/[. ]+$/, '')).slice(0, 100).join('');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeTitle || 'Study guide'}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
