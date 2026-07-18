'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import {
  Locale,
  NotificationChannel,
  NotificationEvent,
  templateUpsertSchema,
} from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/empty-state';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { settingsApi } from '../api';
import { useApiErrorToast, useHasPermission } from '../hooks';

const EVENTS = Object.values(NotificationEvent);
const CHANNELS = Object.values(NotificationChannel);
const LOCALES: Locale[] = [Locale.UZ, Locale.UZ_CYRL, Locale.RU, Locale.EN];
const VARIABLES = ['{{patient_name}}', '{{time}}', '{{doctor_name}}', '{{clinic_name}}'];

export function TemplatesTab() {
  const t = useTranslations('notifications');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useHasPermission('notifications.templates.write');

  const [event, setEvent] = useState<NotificationEvent>(NotificationEvent.APPOINTMENT_CREATED);
  const [channel, setChannel] = useState<NotificationChannel>(NotificationChannel.SMS);
  const [locale, setLocale] = useState<Locale>(Locale.UZ);
  const [body, setBody] = useState('');

  const templatesQuery = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => settingsApi.listTemplates(),
  });
  const templates = templatesQuery.data?.data ?? [];

  const current = templates.find(
    (tpl) => tpl.event === event && tpl.channel === channel && tpl.locale === locale,
  );

  useEffect(() => {
    setBody(current?.body ?? '');
  }, [current?.id, current?.body]);

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = templateUpsertSchema.parse({ event, channel, locale, body });
      return settingsApi.upsertTemplate(parsed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      toast.success(t('templates.saved'));
    },
    onError: (err) => {
      if (err instanceof Error && err.name === 'ZodError') toast.error(t('templates.bodyTooShort'));
      else errorToast(err);
    },
  });

  const insertVariable = (variable: string) => {
    setBody((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}${variable}`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('templates.title')}</CardTitle>
          <CardDescription>{t('templates.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('templates.event')}</Label>
              <Select value={event} onValueChange={(v) => setEvent(v as NotificationEvent)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENTS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {t(`events.${e}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('templates.channel')}</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as NotificationChannel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {enumLabel('channel', c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('templates.locale')}</Label>
              <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`locales.${l.replace('-', '_')}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-body">{t('templates.body')}</Label>
            <Textarea
              id="template-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('templates.bodyPlaceholder')}
              disabled={!canWrite}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('templates.variablesHint')}:</span>
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                  onClick={() => insertVariable(v)}
                  disabled={!canWrite}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => mutation.mutate()}
              disabled={!canWrite || mutation.isPending || body.trim().length < 3}
            >
              {t('templates.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('templates.savedList')}</CardTitle>
        </CardHeader>
        <CardContent>
          {templatesQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title={t('templates.emptyTitle')}
              description={t('templates.emptyDesc')}
            />
          ) : (
            <ul className="divide-y">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left hover:bg-muted/50"
                    onClick={() => {
                      setEvent(tpl.event);
                      setChannel(tpl.channel);
                      setLocale(tpl.locale);
                    }}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{t(`events.${tpl.event}` as never)}</span>
                      <Badge variant="outline">{enumLabel('channel', tpl.channel)}</Badge>
                      <Badge variant="outline">
                        {t(`locales.${tpl.locale.replace('-', '_')}` as never)}
                      </Badge>
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">{tpl.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
