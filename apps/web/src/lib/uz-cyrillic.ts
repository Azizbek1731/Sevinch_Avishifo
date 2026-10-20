/**
 * Latin Uzbek → Cyrillic Uzbek, same rules as scripts/uz-latin-to-cyrillic.mjs.
 * Service and analyte names are stored in Latin; the Cyrillic UI has no separate column.
 */
const A = "['‘’ʻʼ`]";

const RULES: Array<[RegExp, string | ((m: string) => string)]> = [
  [new RegExp(`[Yy]o${A}`, 'g'), (m) => (m[0] === 'Y' ? 'Йў' : 'йў')],
  [new RegExp(`O${A}`, 'g'), 'Ў'],
  [new RegExp(`o${A}`, 'g'), 'ў'],
  [new RegExp(`G${A}`, 'g'), 'Ғ'],
  [new RegExp(`g${A}`, 'g'), 'ғ'],
  [/Yo/g, 'Ё'],
  [/YO/g, 'Ё'],
  [/yo/g, 'ё'],
  [/Ya/g, 'Я'],
  [/YA/g, 'Я'],
  [/ya/g, 'я'],
  [/Yu/g, 'Ю'],
  [/YU/g, 'Ю'],
  [/yu/g, 'ю'],
  [/Ye/g, 'Е'],
  [/YE/g, 'Е'],
  [/ye/g, 'е'],
  [/Sh/g, 'Ш'],
  [/SH/g, 'Ш'],
  [/sh/g, 'ш'],
  [/Ch/g, 'Ч'],
  [/CH/g, 'Ч'],
  [/ch/g, 'ч'],
  [/[Tt]s(?=[iaeouy])/g, (m) => (m[0] === 'T' ? 'Ц' : 'ц')],
  [/A/g, 'А'],
  [/a/g, 'а'],
  [/B/g, 'Б'],
  [/b/g, 'б'],
  [/D/g, 'Д'],
  [/d/g, 'д'],
  [/E/g, 'Е'],
  [/e/g, 'е'],
  [/F/g, 'Ф'],
  [/f/g, 'ф'],
  [/G/g, 'Г'],
  [/g/g, 'г'],
  [/H/g, 'Ҳ'],
  [/h/g, 'ҳ'],
  [/I/g, 'И'],
  [/i/g, 'и'],
  [/J/g, 'Ж'],
  [/j/g, 'ж'],
  [/K/g, 'К'],
  [/k/g, 'к'],
  [/L/g, 'Л'],
  [/l/g, 'л'],
  [/M/g, 'М'],
  [/m/g, 'м'],
  [/N/g, 'Н'],
  [/n/g, 'н'],
  [/O/g, 'О'],
  [/o/g, 'о'],
  [/P/g, 'П'],
  [/p/g, 'п'],
  [/Q/g, 'Қ'],
  [/q/g, 'қ'],
  [/R/g, 'Р'],
  [/r/g, 'р'],
  [/S/g, 'С'],
  [/s/g, 'с'],
  [/T/g, 'Т'],
  [/t/g, 'т'],
  [/U/g, 'У'],
  [/u/g, 'у'],
  [/V/g, 'В'],
  [/v/g, 'в'],
  [/X/g, 'Х'],
  [/x/g, 'х'],
  [/Y/g, 'Й'],
  [/y/g, 'й'],
  [/Z/g, 'З'],
  [/z/g, 'з'],
  [/W/g, 'В'],
  [/w/g, 'в'],
  [/C/g, 'С'],
  [/c/g, 'с'],
];

function translitWord(word: string): string {
  let s = word
    .replace(/(^|[aeiouAEIOU'’ʻʼ`\s(«"–—-])E/g, '$1Э')
    .replace(/(^|[aeiouAEIOU'’ʻʼ`\s(«"–—-])e/g, '$1э');
  for (const [re, to] of RULES) {
    s = typeof to === 'string' ? s.replace(re, to) : s.replace(re, to);
  }
  return s.replace(/['‘’ʻʼ`]/g, 'ъ');
}

export function transliterateUzLatn(text: string): string {
  return translitWord(text);
}
