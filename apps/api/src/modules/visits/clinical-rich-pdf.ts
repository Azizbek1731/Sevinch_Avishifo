/**
 * Render TipTap / clinical HTML into PDFKit while preserving
 * paragraph order, lists, bold/italic/underline, align, and font size.
 * Plain text (legacy notes) still works.
 *
 * Critical: inline style changes (bold/span) must NOT start a new line —
 * they continue the current paragraph via PDFKit `continued: true`.
 */

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value.trim());
}

/** Strip tags for emptiness / character counts. */
export function stripClinicalHtml(value: string): string {
  if (!value) return '';
  if (!looksLikeHtml(value)) return value;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hasClinicalText(value: string | null | undefined): boolean {
  return Boolean(stripClinicalHtml(value ?? ''));
}

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
};

type BlockAlign = 'left' | 'center' | 'right' | 'justify';

type TextRun = {
  text: string;
  style: InlineStyle;
};

type Block = {
  kind: 'paragraph' | 'heading' | 'list-item';
  align: BlockAlign;
  runs: TextRun[];
  listBullet?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfLike = any;

const SKIP_TAGS = new Set(['script', 'style', 'head', 'meta', 'link']);

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseStyle(styleAttr: string | undefined): {
  fontSize?: number;
  align?: BlockAlign;
  bold?: boolean;
  underline?: boolean;
} {
  if (!styleAttr) return {};
  const fontSizeMatch = styleAttr.match(/font-size:\s*([\d.]+)(px|pt)?/i);
  const alignMatch = styleAttr.match(/text-align:\s*(left|center|right|justify)/i);
  const weightMatch = styleAttr.match(/font-weight:\s*([a-z0-9]+)/i);
  const decorationMatch = styleAttr.match(/text-decoration:\s*([^;]+)/i);
  let fontSize: number | undefined;
  if (fontSizeMatch) {
    const n = Number(fontSizeMatch[1]);
    const unit = (fontSizeMatch[2] || 'px').toLowerCase();
    fontSize = unit === 'pt' ? n : Math.round(n * 0.75 * 10) / 10;
  }
  const alignRaw = alignMatch?.[1]?.toLowerCase();
  const weight = weightMatch?.[1]?.toLowerCase();
  const bold =
    weight === 'bold' || weight === 'bolder' || (weight != null && Number(weight) >= 600)
      ? true
      : undefined;
  const underline = decorationMatch?.[1]?.toLowerCase().includes('underline') ? true : undefined;
  return {
    fontSize,
    bold,
    underline,
    align:
      alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right' || alignRaw === 'justify'
        ? alignRaw
        : undefined,
  };
}

function tokenize(
  html: string,
): Array<{ kind: 'open' | 'close' | 'text' | 'br'; tag?: string; attrs?: string; text?: string }> {
  const tokens: Array<{
    kind: 'open' | 'close' | 'text' | 'br';
    tag?: string;
    attrs?: string;
    text?: string;
  }> = [];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9]+)(\s[^>]*)?\s*\/?>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[0].startsWith('<')) {
      const tag = (m[1] ?? '').toLowerCase();
      if (!tag) continue;
      const selfClosing = /\/>$/.test(m[0]) || tag === 'br' || tag === 'hr';
      if (tag === 'br') {
        tokens.push({ kind: 'br' });
        continue;
      }
      if (selfClosing) continue;
      if (m[0].startsWith('</')) tokens.push({ kind: 'close', tag });
      else tokens.push({ kind: 'open', tag, attrs: m[2] ?? '' });
    } else if (m[3]) {
      tokens.push({ kind: 'text', text: decodeEntities(m[3]) });
    }
  }
  return tokens;
}

function attrValue(attrs: string | undefined, name: string): string | undefined {
  if (!attrs) return undefined;
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = attrs.match(re);
  return m?.[2] ?? m?.[3];
}

function sameStyle(a: InlineStyle, b: InlineStyle): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    (a.fontSize ?? null) === (b.fontSize ?? null)
  );
}

/** Build paragraph/list blocks from HTML — runs stay in document order. */
export function parseClinicalBlocks(html: string): Block[] {
  type Frame = { tag: string; style: InlineStyle; align?: BlockAlign };
  const stack: Frame[] = [{ tag: 'root', style: {} }];
  const blocks: Block[] = [];
  let current: Block | null = null;
  let pendingList: 'ul' | 'ol' | null = null;
  let listIndex = 0;
  let blockAlign: BlockAlign = 'left';

  const styleNow = () => stack[stack.length - 1]!.style;

  const ensureBlock = (kind: Block['kind'] = 'paragraph', bullet?: string) => {
    if (!current) {
      current = { kind, align: blockAlign, runs: [], listBullet: bullet };
    }
    return current;
  };

  const pushText = (raw: string) => {
    if (!raw) return;
    // Collapse whitespace but keep intentional single spaces between words.
    const text = raw.replace(/\s+/g, ' ');
    if (!text || (text === ' ' && !(current?.runs.length))) return;
    const block = ensureBlock();
    const style = { ...styleNow() };
    const last = block.runs[block.runs.length - 1];
    if (last && sameStyle(last.style, style)) last.text += text;
    else block.runs.push({ text, style });
  };

  const softBreak = () => {
    const block = ensureBlock();
    const last = block.runs[block.runs.length - 1];
    if (last) last.text += '\n';
    else block.runs.push({ text: '\n', style: { ...styleNow() } });
  };

  const endBlock = () => {
    if (!current) return;
    // Drop empty shells (TipTap often emits <p></p> / <p><br></p>).
    const plain = current.runs.map((r) => r.text).join('').replace(/\s+/g, '');
    if (plain) blocks.push(current);
    current = null;
    blockAlign = 'left';
  };

  for (const tok of tokenize(html)) {
    if (tok.kind === 'text') {
      pushText(tok.text ?? '');
      continue;
    }
    if (tok.kind === 'br') {
      softBreak();
      continue;
    }
    if (tok.kind === 'open') {
      const tag = tok.tag!;
      if (SKIP_TAGS.has(tag)) continue;
      const parent = { ...styleNow() };
      const parsed = parseStyle(attrValue(tok.attrs, 'style'));
      if (tag === 'strong' || tag === 'b') parent.bold = true;
      if (tag === 'em' || tag === 'i') parent.italic = true;
      if (tag === 'u') parent.underline = true;
      if (tag === 'h2') {
        parent.bold = true;
        parent.fontSize = 13;
      }
      if (tag === 'h3') {
        parent.bold = true;
        parent.fontSize = 11.5;
      }
      if (parsed.fontSize) parent.fontSize = parsed.fontSize;
      if (parsed.bold) parent.bold = true;
      if (parsed.underline) parent.underline = true;
      if (parsed.align) blockAlign = parsed.align;

      if (tag === 'ul' || tag === 'ol') {
        endBlock();
        pendingList = tag;
        listIndex = 0;
        stack.push({ tag, style: parent });
        continue;
      }
      if (tag === 'li') {
        endBlock();
        listIndex += 1;
        const bullet = pendingList === 'ol' ? `${listIndex}. ` : '• ';
        ensureBlock('list-item', bullet);
        stack.push({ tag, style: parent });
        continue;
      }
      if (tag === 'p' || tag === 'div') {
        endBlock();
        if (parsed.align) blockAlign = parsed.align;
        ensureBlock('paragraph');
        stack.push({ tag, style: parent, align: parsed.align });
        continue;
      }
      if (tag === 'h2' || tag === 'h3') {
        endBlock();
        if (parsed.align) blockAlign = parsed.align;
        ensureBlock('heading');
        stack.push({ tag, style: parent, align: parsed.align });
        continue;
      }
      // Inline tags (span/strong/em/u/…): style only — do not break the line.
      stack.push({ tag, style: parent, align: parsed.align });
      continue;
    }
    if (tok.kind === 'close') {
      const tag = tok.tag!;
      if (tag === 'ul' || tag === 'ol') {
        endBlock();
        pendingList = null;
        listIndex = 0;
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (tag === 'li' || tag === 'p' || tag === 'div' || tag === 'h2' || tag === 'h3') {
        endBlock();
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (stack.length > 1) stack.pop();
    }
  }
  endBlock();
  return blocks;
}

function drawRuns(
  doc: PdfLike,
  runs: TextRun[],
  options: {
    width: number;
    x: number;
    ink: string;
    defaultSize: number;
    align: BlockAlign;
    prefix?: string;
  },
): void {
  const pieces: TextRun[] = [];
  if (options.prefix) {
    pieces.push({ text: options.prefix, style: { bold: false } });
  }
  for (const run of runs) {
    // Split soft line-breaks so each visual line is its own PDFKit paragraph chain.
    const parts = run.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) pieces.push({ text: '\n', style: run.style });
      if (parts[i]) pieces.push({ text: parts[i]!, style: run.style });
    }
  }

  // Merge adjacent same-style pieces (except explicit newlines).
  const merged: TextRun[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (piece.text === '\n') {
      merged.push(piece);
      continue;
    }
    if (last && last.text !== '\n' && sameStyle(last.style, piece.style)) {
      last.text += piece.text;
    } else {
      merged.push({ ...piece, style: { ...piece.style } });
    }
  }

  let line: TextRun[] = [];
  const flushLine = () => {
    if (line.length === 0) return;
    // Skip whitespace-only lines.
    if (!line.some((r) => r.text.trim())) {
      line = [];
      doc.moveDown(0.25);
      return;
    }
    for (let i = 0; i < line.length; i++) {
      const run = line[i]!;
      const last = i === line.length - 1;
      const fontName = run.style.bold ? 'bold' : 'body';
      const size = run.style.fontSize ?? options.defaultSize;
      doc.font(fontName).fontSize(size).fillColor(options.ink);
      doc.text(run.text, options.x, doc.y, {
        width: options.width,
        align: options.align,
        lineGap: 2.5,
        continued: !last,
        underline: Boolean(run.style.underline),
      });
    }
    doc.x = options.x;
    line = [];
  };

  for (const piece of merged) {
    if (piece.text === '\n') {
      flushLine();
      continue;
    }
    line.push(piece);
  }
  flushLine();
}

/**
 * Draw clinical HTML (or plain text) into the PDF document.
 */
export function drawClinicalRichText(
  doc: PdfLike,
  raw: string,
  options: {
    width: number;
    x: number;
    ink: string;
    defaultSize?: number;
    ensureSpace?: (needed: number) => void;
  },
): void {
  const defaultSize = options.defaultSize ?? 10.5;
  const text = (raw ?? '').trim();
  if (!text) return;

  if (!looksLikeHtml(text)) {
    options.ensureSpace?.(80);
    doc
      .font('body')
      .fontSize(defaultSize)
      .fillColor(options.ink)
      .text(text, options.x, doc.y, {
        width: options.width,
        lineGap: 2.5,
        paragraphGap: 6,
        align: 'left',
      });
    return;
  }

  const blocks = parseClinicalBlocks(text);
  for (const block of blocks) {
    options.ensureSpace?.(56);
    drawRuns(doc, block.runs, {
      width: options.width,
      x: options.x,
      ink: options.ink,
      defaultSize: block.kind === 'heading' ? Math.max(defaultSize + 2, 12) : defaultSize,
      align: block.align,
      prefix: block.listBullet,
    });
    doc.moveDown(block.kind === 'heading' ? 0.35 : 0.45);
    doc.x = options.x;
  }
}
