/** Escape plain text for safe HTML paragraphs. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value.trim());
}

/** Plain length for counters / empty checks. */
export function stripClinicalHtml(value: string): string {
  if (!value) return '';
  if (!looksLikeHtml(value)) return value;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turn legacy plain-text notes into TipTap-friendly paragraphs. */
export function plainTextToHtml(value: string): string {
  const raw = value ?? '';
  if (!raw.trim()) return '<p></p>';
  if (looksLikeHtml(raw)) return raw;
  return raw
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'span',
  'div',
]);

/** Lightweight allowlist sanitizer for clinical HTML (browser). */
export function sanitizeClinicalHtml(html: string): string {
  if (typeof document === 'undefined') {
    return looksLikeHtml(html) ? html : plainTextToHtml(html);
  }
  if (!looksLikeHtml(html)) return plainTextToHtml(html);
  const template = document.createElement('template');
  template.innerHTML = html;
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (name === 'style') {
            const size = el.style.fontSize;
            const align = el.style.textAlign;
            el.removeAttribute('style');
            const parts: string[] = [];
            if (size && /^\d+(\.\d+)?(px|pt)$/i.test(size)) parts.push(`font-size: ${size}`);
            if (align && /^(left|center|right|justify)$/i.test(align)) {
              parts.push(`text-align: ${align}`);
            }
            if (parts.length) el.setAttribute('style', parts.join('; '));
          } else {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
      }
    }
  };
  walk(template.content);
  const out = template.innerHTML.trim();
  return out || '<p></p>';
}
