'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, Circle, Rocket } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { usePermissions } from '@/hooks/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SetupStatus {
  profileComplete: boolean;
  hasStaff: boolean;
  hasPricedService: boolean;
  hasSchedule: boolean;
  hasPatient: boolean;
  done: number;
  total: number;
  complete: boolean;
}

/** Each unfinished item points at the exact screen that finishes it. */
const ITEMS: Array<{ key: keyof SetupStatus & string; href: string }> = [
  { key: 'profileComplete', href: '/settings' },
  { key: 'hasPricedService', href: '/services' },
  { key: 'hasStaff', href: '/settings' },
  { key: 'hasSchedule', href: '/staff' },
  { key: 'hasPatient', href: '/patients' },
];

/**
 * The first-run checklist. It reads real data — a clinic profile that is
 * actually filled, a service that actually has a price — never boxes anyone
 * ticked, so it cannot lie. Once everything is genuinely done it vanishes on
 * its own and never comes back.
 */
export function SetupChecklist() {
  const t = useTranslations('dashboard');
  const can = usePermissions();

  const status = useQuery({
    queryKey: ['clinic', 'setup-status'],
    queryFn: async () => (await api.get<SetupStatus>('/clinic/setup-status')).data,
    enabled: can('clinic.settings.read'),
    staleTime: 60_000,
  });

  const s = status.data;
  if (!s || s.complete) return null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4 text-primary" />
          {t('setup.title')}
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {t('setup.progress', { done: s.done, total: s.total })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {ITEMS.map(({ key, href }) => {
            const ok = Boolean(s[key]);
            return (
              <li key={key}>
                {ok ? (
                  <span className="flex min-h-9 items-center gap-2 px-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    <span className="line-through decoration-muted-foreground/40">
                      {t(`setup.items.${key}` as never)}
                    </span>
                  </span>
                ) : (
                  <Link
                    href={href}
                    className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-accent"
                  >
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{t(`setup.items.${key}` as never)}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
