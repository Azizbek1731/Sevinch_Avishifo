'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, Info, Send, ShieldCheck, User } from 'lucide-react';
import type { AiAnswer, AiCapabilities } from '@avishifo/shared';
import { api, ApiError } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  usedTools?: string[];
}

/**
 * AviShifo AI — ask about this clinic in plain language.
 *
 * The assistant can only reach a fixed set of read-only tools, each scoped to
 * the signed-in user's own clinic and their own permissions, so it can never
 * show more than the panel already would. The reply lists which data it opened,
 * because an answer a user cannot trace is an answer they cannot check.
 */
export function AiPage() {
  const t = useTranslations('ai');
  const tErr = useTranslations('errors');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const caps = useQuery({
    queryKey: ['ai', 'capabilities'],
    queryFn: async () => (await api.get<AiCapabilities>('/ai/capabilities')).data,
  });

  const ask = useMutation({
    mutationFn: async (q: string) => (await api.post<AiAnswer>('/ai/ask', { question: q })).data,
    onSuccess: (data) =>
      setTurns((prev) => [...prev, { role: 'assistant', text: data.answer, usedTools: data.usedTools }]),
    onError: (err) =>
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: err instanceof ApiError ? tErr(err.code as never) : tErr('INTERNAL_ERROR'),
        },
      ]),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, ask.isPending]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3 || ask.isPending) return;
    setTurns((prev) => [...prev, { role: 'user', text: q }]);
    setQuestion('');
    ask.mutate(q);
  };

  const disabled = caps.data?.enabled === false;

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col gap-4 md:h-[calc(100dvh-10rem)]">
      <PageHeader title={t('title')} description={t('description')} />

      {caps.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : disabled ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('disabledTitle')}</p>
              <p className="mt-1 text-muted-foreground">{t('disabledBody')}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {turns.length === 0 ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <p>{t('privacyNote')}</p>
                </div>
                <p className="text-sm font-medium text-muted-foreground">{t('examplesTitle')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(t.raw('examples') as string[]).map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQuestion(ex)}
                      className="min-h-11 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn, i) => (
                <div key={i} className="flex gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      turn.role === 'user' ? 'bg-muted' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {turn.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.text}</p>
                    {turn.usedTools && turn.usedTools.length > 0 ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {t('usedData')}: {turn.usedTools.map((n) => t(`tools.${n}` as never)).join(', ')}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {ask.isPending ? (
              <div className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <Skeleton className="h-5 w-40" />
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="flex shrink-0 items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline. On a phone the on-screen
                // keyboard has no Shift, so the button is the reliable path.
                if (e.key === 'Enter' && !e.shiftKey) submit(e);
              }}
              rows={1}
              placeholder={t('placeholder')}
              className="max-h-32 min-h-11 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2.5 text-base shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
            />
            <Button type="submit" size="lg" disabled={question.trim().length < 3 || ask.isPending}>
              <Send className="h-4 w-4" />
              <span className="sr-only">{t('send')}</span>
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
