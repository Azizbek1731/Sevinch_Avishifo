'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ChevronRight, Lightbulb, LifeBuoy, Search } from 'lucide-react';
import type { Permission } from '@avishifo/shared';
import { usePermissions } from '@/hooks/use-permissions';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The help content lives in messages/{locale}/help.json as structured blocks,
 * not in this component: prose belongs with the other prose, rides the same
 * uz→Cyrillic pipeline, and stays editable without touching code.
 *
 * A block is an object with exactly one key naming its kind.
 */
type HelpBlock =
  | { p: string }
  | { steps: string[] }
  | { tip: string }
  | { warn: string }
  | { faq: { q: string; a: string } };

interface HelpTopic {
  id: string;
  title: string;
  /** Shown only to holders — a reader must never see instructions they cannot follow. */
  perm?: string;
  blocks: HelpBlock[];
}

interface HelpSection {
  id: string;
  title: string;
  perm?: string;
  topics: HelpTopic[];
}

/** Every human-readable string of a topic, for the search index. */
function topicText(topic: HelpTopic): string {
  const parts: string[] = [topic.title];
  for (const b of topic.blocks) {
    if ('p' in b) parts.push(b.p);
    else if ('steps' in b) parts.push(...b.steps);
    else if ('tip' in b) parts.push(b.tip);
    else if ('warn' in b) parts.push(b.warn);
    else if ('faq' in b) parts.push(b.faq.q, b.faq.a);
  }
  return parts.join(' ').toLowerCase();
}

function Block({ block }: { block: HelpBlock }) {
  if ('p' in block) return <p className="my-2 text-sm leading-relaxed">{block.p}</p>;
  if ('steps' in block) {
    return (
      <ol className="my-2 list-none space-y-1.5 p-0" role="list">
        {block.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    );
  }
  if ('tip' in block) {
    return (
      <p className="my-2 flex gap-2 rounded-md bg-primary/5 p-2.5 text-sm leading-relaxed">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>{block.tip}</span>
      </p>
    );
  }
  if ('warn' in block) {
    return (
      <p className="my-2 flex gap-2 rounded-md bg-destructive/5 p-2.5 text-sm leading-relaxed">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>{block.warn}</span>
      </p>
    );
  }
  return (
    <div className="my-2 rounded-md border p-2.5 text-sm">
      <p className="m-0 font-medium">{block.faq.q}</p>
      <p className="m-0 mt-1 leading-relaxed text-muted-foreground">{block.faq.a}</p>
    </div>
  );
}

export function HelpPage() {
  const t = useTranslations('help');
  const can = usePermissions();
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Sections and topics the CALLER may act on — a receptionist never reads
  // payroll instructions, a lab tech never reads register-closing ones.
  const sections = useMemo(() => {
    const raw = t.raw('sections') as HelpSection[];
    return raw
      .filter((s) => !s.perm || can(s.perm as Permission))
      .map((s) => ({
        ...s,
        topics: s.topics.filter((topic) => !topic.perm || can(topic.perm as Permission)),
      }))
      .filter((s) => s.topics.length > 0);
  }, [t, can]);

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;

  const visible = useMemo(() => {
    if (searching) {
      return sections
        .map((s) => ({ ...s, topics: s.topics.filter((topic) => topicText(topic).includes(q)) }))
        .filter((s) => s.topics.length > 0);
    }
    if (activeSection) return sections.filter((s) => s.id === activeSection);
    return sections;
  }, [sections, searching, q, activeSection]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {!searching ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveSection(null)}
            className={cn(
              'min-h-8 rounded-full border px-3 text-sm transition-colors',
              activeSection === null
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-accent',
            )}
          >
            {t('all')}
          </button>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(activeSection === s.id ? null : s.id)}
              className={cn(
                'min-h-8 rounded-full border px-3 text-sm transition-colors',
                activeSection === s.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-accent',
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <LifeBuoy className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {visible.map((section) => (
            <section key={section.id} aria-labelledby={`help-${section.id}`}>
              <h2
                id={`help-${section.id}`}
                className="mb-2 flex items-center gap-1.5 text-lg font-semibold"
              >
                {section.title}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {section.topics.map((topic) => (
                  <Card key={topic.id}>
                    <CardContent className="p-4">
                      <h3 className="mb-1 text-base font-semibold">{topic.title}</h3>
                      {topic.blocks.map((b, i) => (
                        <Block key={i} block={b} />
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
