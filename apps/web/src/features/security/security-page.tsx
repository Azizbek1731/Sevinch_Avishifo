'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Send, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

/** Public bot handle — the link a user follows to bind their chat. */
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? 'AviShifoBot';

/**
 * Per-user security settings. Available to every role including SUPER_ADMIN,
 * which is why it lives outside clinic settings.
 *
 * The second factor is opt-in and can only be switched on once a Telegram chat
 * is linked — the API enforces that too, because a user who enables it blind
 * would be asked for a code that has nowhere to arrive.
 */
export function SecurityPage() {
  const t = useTranslations('security');
  const tErr = useTranslations('errors');
  const qc = useQueryClient();
  const security = useAuthStore((s) => s.security);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const linked = security?.telegramLinked ?? false;
  const enabled = optimistic ?? security?.twoFactorEnabled ?? false;

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await api.post<{ twoFactorEnabled: boolean }>('/auth/two-factor', {
        enabled: next,
      });
      return res.data.twoFactorEnabled;
    },
    onMutate: (next) => setOptimistic(next),
    onSuccess: async (value) => {
      setOptimistic(null);
      useAuthStore.getState().setTwoFactorEnabled(value);
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(value ? t('enabledToast') : t('disabledToast'));
    },
    onError: (err) => {
      setOptimistic(null);
      toast.error(err instanceof ApiError ? tErr(err.code as never) : tErr('INTERNAL_ERROR'));
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Telegram binding */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Send className="h-5 w-5 text-primary" />
              {t('telegram.title')}
            </CardTitle>
            <CardDescription>{t('telegram.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {linked ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div>
                  <p className="font-medium">{t('telegram.linked')}</p>
                  {security?.telegramUsername ? (
                    <p className="text-muted-foreground">@{security.telegramUsername}</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="space-y-2">
                  <p className="font-medium">{t('telegram.notLinked')}</p>
                  <p className="text-muted-foreground">{t('telegram.howTo')}</p>
                  <Button asChild size="sm">
                    <a
                      href={`https://t.me/${BOT_USERNAME}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <Send className="h-4 w-4" />
                      {t('telegram.open', { bot: BOT_USERNAME })}
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Second factor */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {enabled ? (
                <ShieldCheck className="h-5 w-5 text-success" />
              ) : (
                <ShieldOff className="h-5 w-5 text-muted-foreground" />
              )}
              {t('twoFactor.title')}
            </CardTitle>
            <CardDescription>{t('twoFactor.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t('twoFactor.label')}</p>
                <p className="text-xs text-muted-foreground">
                  {enabled ? t('twoFactor.on') : t('twoFactor.off')}
                </p>
              </div>
              <Switch
                checked={enabled}
                disabled={!linked || mutation.isPending}
                onCheckedChange={(v) => mutation.mutate(v)}
                aria-label={t('twoFactor.label')}
              />
            </div>
            {!linked ? (
              <p className="text-xs text-muted-foreground">{t('twoFactor.needsTelegram')}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
