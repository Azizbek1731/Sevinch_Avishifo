'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { AMBULATORY_SHARE_GROUPS, type AmbulatoryShareGroup } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import { useApiErrorToast } from '@/features/services/hooks';
import { ambulatoryApi } from '../api';
import { groupTone } from './commissions-tab';

type PercentDraft = Record<AmbulatoryShareGroup, string>;

const emptyDraft: PercentDraft = { LAB: '', UZI: '', EXO: '', THERAPY: '' };

const validPercent = (value: string) => {
  const n = Number(value.replace(',', '.'));
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
};

const parsePercent = (value: string) =>
  value.trim() === '' ? null : Number(value.replace(',', '.'));

const draftOf = (percents: Record<AmbulatoryShareGroup, number | null>): PercentDraft => ({
  LAB: percents.LAB === null ? '' : String(percents.LAB),
  UZI: percents.UZI === null ? '' : String(percents.UZI),
  EXO: percents.EXO === null ? '' : String(percents.EXO),
  THERAPY: percents.THERAPY === null ? '' : String(percents.THERAPY),
});

/**
 * Referring-doctor shares per direction (lab, UZI, EXO, therapy): clinic defaults,
 * per-doctor overrides and the list of ultrasound examinations counted as EXO.
 */
export function RatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('ambulatory.rates');
  const tGroups = useTranslations('ambulatory.groups');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const [defaults, setDefaults] = useState<PercentDraft>(emptyDraft);
  const [overrides, setOverrides] = useState<Record<string, PercentDraft>>({});
  const [echoIds, setEchoIds] = useState<Set<string>>(new Set());
  const [doctorSearch, setDoctorSearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');

  const query = useQuery({
    queryKey: ['ambulatory', 'rates'],
    enabled: open,
    queryFn: async () => (await ambulatoryApi.rates()).data,
  });

  useEffect(() => {
    if (!open || !query.data) return;
    setDefaults(draftOf(query.data.defaults));
    setOverrides(
      Object.fromEntries(
        query.data.doctors.map((doctor) => [doctor.doctorUserId, draftOf(doctor.percents)]),
      ),
    );
    setEchoIds(
      new Set(query.data.ultrasoundServices.filter((service) => service.isEcho).map((s) => s.id)),
    );
    setDoctorSearch('');
    setServiceSearch('');
  }, [open, query.data]);

  const invalid =
    AMBULATORY_SHARE_GROUPS.some((group) => !validPercent(defaults[group])) ||
    Object.values(overrides).some((draft) =>
      AMBULATORY_SHARE_GROUPS.some(
        (group) => draft[group].trim() !== '' && !validPercent(draft[group]),
      ),
    );

  const doctors = useMemo(() => {
    const needle = doctorSearch.trim().toLowerCase();
    const all = query.data?.doctors ?? [];
    if (!needle) return all;
    return all.filter((doctor) =>
      `${doctor.fullName} ${doctor.specialty ?? ''}`.toLowerCase().includes(needle),
    );
  }, [query.data, doctorSearch]);

  const services = useMemo(() => {
    const needle = serviceSearch.trim().toLowerCase();
    const all = query.data?.ultrasoundServices ?? [];
    if (!needle) return all;
    return all.filter((service) =>
      `${service.code} ${localizedText(service.name, locale)} ${service.category}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query.data, serviceSearch, locale]);

  const save = useMutation({
    mutationFn: () =>
      ambulatoryApi.saveRates({
        defaults: {
          LAB: Number(defaults.LAB.replace(',', '.')),
          UZI: Number(defaults.UZI.replace(',', '.')),
          EXO: Number(defaults.EXO.replace(',', '.')),
          THERAPY: Number(defaults.THERAPY.replace(',', '.')),
        },
        doctors: Object.entries(overrides).map(([doctorUserId, draft]) => ({
          doctorUserId,
          percents: {
            LAB: parsePercent(draft.LAB),
            UZI: parsePercent(draft.UZI),
            EXO: parsePercent(draft.EXO),
            THERAPY: parsePercent(draft.THERAPY),
          },
        })),
        echoServiceIds: [...echoIds],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      toast.success(t('saved'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const setOverride = (doctorUserId: string, group: AmbulatoryShareGroup, value: string) =>
    setOverrides((prev) => ({
      ...prev,
      [doctorUserId]: { ...(prev[doctorUserId] ?? emptyDraft), [group]: value },
    }));

  const toggleEcho = (serviceId: string, checked: boolean) =>
    setEchoIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(serviceId);
      else next.delete(serviceId);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border bg-muted/25 p-3">
              <p className="text-sm font-medium">{t('default')}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {AMBULATORY_SHARE_GROUPS.map((group) => (
                  <div key={group} className="space-y-1">
                    <Label htmlFor={`amb-default-${group}`}>{tGroups(group)}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`amb-default-${group}`}
                        inputMode="decimal"
                        value={defaults[group]}
                        aria-invalid={!validPercent(defaults[group])}
                        onChange={(event) =>
                          setDefaults((prev) => ({ ...prev, [group]: event.target.value }))
                        }
                      />
                      <span className="text-muted-foreground">%</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('defaultHelp')}</p>
            </div>

            <Tabs defaultValue="doctors">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="doctors">{t('perDoctor')}</TabsTrigger>
                <TabsTrigger value="echo">
                  {t('echoTab')}
                  <Badge variant="secondary" className="ml-2">
                    {echoIds.size}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="doctors" className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={t('searchDoctor')}
                    value={doctorSearch}
                    onChange={(event) => setDoctorSearch(event.target.value)}
                  />
                </div>
                <div className="divide-y rounded-lg border">
                  <div className="hidden grid-cols-[1fr_repeat(4,4.75rem)] gap-2 bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:grid">
                    <span>{t('doctor')}</span>
                    {AMBULATORY_SHARE_GROUPS.map((group) => (
                      <span key={group} className="text-center">
                        {tGroups(group)} %
                      </span>
                    ))}
                  </div>
                  {doctors.map((doctor) => {
                    const draft = overrides[doctor.doctorUserId] ?? emptyDraft;
                    return (
                      <div
                        key={doctor.doctorUserId}
                        className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_repeat(4,4.75rem)] sm:items-center"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{doctor.fullName}</p>
                          {doctor.specialty ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {doctor.specialty}
                            </p>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-4 gap-2 sm:contents">
                          {AMBULATORY_SHARE_GROUPS.map((group) => (
                            <Input
                              key={group}
                              inputMode="decimal"
                              aria-label={`${doctor.fullName} — ${tGroups(group)}`}
                              className={cn('text-center', draft[group].trim() && groupTone[group])}
                              placeholder={defaults[group] || '—'}
                              value={draft[group]}
                              aria-invalid={draft[group].trim() !== '' && !validPercent(draft[group])}
                              onChange={(event) =>
                                setOverride(doctor.doctorUserId, group, event.target.value)
                              }
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {doctors.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {t('nothingFound')}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{t('perDoctorHelp')}</p>
              </TabsContent>

              <TabsContent value="echo" className="space-y-2">
                <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  {t('echoHelp')}
                </p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={t('searchService')}
                    value={serviceSearch}
                    onChange={(event) => setServiceSearch(event.target.value)}
                  />
                </div>
                <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
                  {services.map((service) => {
                    const checked = echoIds.has(service.id);
                    return (
                      <label
                        key={service.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40',
                          checked && 'bg-rose-50/60 dark:bg-rose-500/10',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleEcho(service.id, value === true)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{localizedText(service.name, locale)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {service.code} · {service.category}
                          </p>
                        </div>
                        <Badge variant="outline" className={groupTone[checked ? 'EXO' : 'UZI']}>
                          {tGroups(checked ? 'EXO' : 'UZI')}
                        </Badge>
                      </label>
                    );
                  })}
                  {services.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {t('nothingFound')}
                    </p>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
        <DialogFooter>
          <Button
            className="w-full"
            disabled={invalid || save.isPending || query.isLoading}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
