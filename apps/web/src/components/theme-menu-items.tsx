'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const;

/**
 * Theme rows for the user dropdown. Rendered as menu items rather than a
 * standalone toggle so the choice sits beside the language it belongs with.
 *
 * Nothing is rendered until after mount: on the server there is no theme yet,
 * and marking a row as active from a guess makes React tear the whole menu
 * down on hydration.
 */
export function ThemeMenuItems() {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Sun className="h-3.5 w-3.5" /> {t('theme.label')}
      </DropdownMenuLabel>
      {OPTIONS.map(({ value, icon: Icon }) => (
        <DropdownMenuItem
          key={value}
          className={mounted && theme === value ? 'font-semibold' : ''}
          onClick={() => setTheme(value)}
        >
          <Icon className="mr-2 h-4 w-4" />
          {t(`theme.${value}` as never)}
        </DropdownMenuItem>
      ))}
    </>
  );
}
