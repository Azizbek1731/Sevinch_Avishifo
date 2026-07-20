'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check, Globe } from 'lucide-react';
import { usePathname, useRouter, type AppLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LOCALES: ReadonlyArray<{ code: AppLocale; short: string; name: string }> = [
  { code: 'uz', short: 'UZ', name: "O'zbekcha (lotin)" },
  { code: 'uz-Cyrl', short: 'ЎЗ', name: 'Ўзбекча (кирилл)' },
  { code: 'ru', short: 'RU', name: 'Русский' },
  { code: 'en', short: 'EN', name: 'English' },
];

/** Compact locale switcher — swaps only the locale segment, keeping the path. */
export function LanguageSwitcher() {
  const t = useTranslations('landing');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const current = LOCALES.find((l) => l.code === locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2.5" aria-label={t('nav.language')}>
          <Globe className="h-4 w-4" />
          <span className="text-xs font-semibold">{current?.short ?? 'UZ'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            className="flex items-center justify-between gap-2"
            onClick={() => router.replace(pathname, { locale: l.code })}
          >
            <span className={l.code === locale ? 'font-semibold' : undefined}>{l.name}</span>
            {l.code === locale ? <Check className="h-4 w-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
