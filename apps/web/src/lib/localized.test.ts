import { describe, expect, it } from 'vitest';
import { localizedText } from './localized';

const lipaza = { uz: 'Lipaza', ru: 'Липаза', en: 'Lipase' };

describe('localizedText', () => {
  it('uses the stored Russian and English names', () => {
    expect(localizedText(lipaza, 'ru')).toBe('Липаза');
    expect(localizedText(lipaza, 'en')).toBe('Lipase');
    expect(localizedText(lipaza, 'uz')).toBe('Lipaza');
  });

  it('transliterates Latin Uzbek when the UI is Cyrillic', () => {
    expect(localizedText(lipaza, 'uz-Cyrl')).toBe('Липаза');
    expect(localizedText("Ko'rsatkich", 'uz-Cyrl')).toBe('Кўрсаткич');
    expect(localizedText('Leykotsitlar', 'uz-Cyrl')).toBe('Лейкоцитлар');
  });

  it('falls back to Uzbek when a translation is missing', () => {
    expect(localizedText({ uz: 'Qon', ru: '' }, 'ru')).toBe('Qon');
    expect(localizedText({ uz: 'Qon' }, 'en')).toBe('Qon');
  });

  it('leaves a plain string unchanged outside the Cyrillic UI', () => {
    expect(localizedText('Natija', 'ru')).toBe('Natija');
    expect(localizedText('Natija', 'uz-Cyrl')).toBe('Натижа');
  });
});
