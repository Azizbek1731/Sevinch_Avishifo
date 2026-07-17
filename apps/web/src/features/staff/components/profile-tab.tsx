'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { upsertStaffProfileSchema, type UpsertStaffProfileInput } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { emptyToUndefined, staffApi, type StaffMember } from '../api';
import { useApiErrorToast, usePermissions } from '../hooks';

export function ProfileTab({ member }: { member: StaffMember }) {
  const t = useTranslations('staff');
  const can = usePermissions();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = can('staff.write');

  const form = useForm<UpsertStaffProfileInput>({
    resolver: zodResolver(upsertStaffProfileSchema),
    defaultValues: {
      specialty: member.specialty ?? undefined,
      licenseNo: member.licenseNo ?? undefined,
      hireDate: member.hireDate ?? undefined,
      bio: member.bio ?? undefined,
      slotMinutes: member.slotMinutes ?? undefined,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: UpsertStaffProfileInput) => staffApi.upsertProfile(member.id, values),
    onSuccess: () => {
      toast.success(t('profile.saved'));
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">{t('profile.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-specialty">{t('profile.specialty')}</Label>
              <Input
                id="profile-specialty"
                autoComplete="off"
                disabled={!canWrite}
                {...form.register('specialty', { setValueAs: emptyToUndefined })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-license">{t('profile.licenseNo')}</Label>
              <Input
                id="profile-license"
                autoComplete="off"
                disabled={!canWrite}
                {...form.register('licenseNo', { setValueAs: emptyToUndefined })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-hire-date">{t('profile.hireDate')}</Label>
              <Input
                id="profile-hire-date"
                type="date"
                disabled={!canWrite}
                {...form.register('hireDate', { setValueAs: emptyToUndefined })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-slot-minutes">{t('profile.slotMinutes')}</Label>
              <Input
                id="profile-slot-minutes"
                type="number"
                min={5}
                max={120}
                step={5}
                disabled={!canWrite}
                {...form.register('slotMinutes', {
                  setValueAs: (v: unknown) =>
                    v === '' || v === null || v === undefined ? undefined : Number(v),
                })}
              />
              {form.formState.errors.slotMinutes ? (
                <p className="text-sm text-destructive">{t('form.invalidNumber')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('profile.slotMinutesHint')}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-bio">{t('profile.bio')}</Label>
            <Textarea
              id="profile-bio"
              rows={4}
              disabled={!canWrite}
              {...form.register('bio', { setValueAs: emptyToUndefined })}
            />
          </div>

          {canWrite ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={mutation.isPending}>
                {t('actions.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
