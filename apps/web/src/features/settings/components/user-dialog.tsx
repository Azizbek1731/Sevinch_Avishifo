'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Locale,
  createUserSchema,
  normalizePhone,
  staffRoleSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useAuthStore } from '@/stores/auth-store';
import { emptyToUndefined, settingsApi, type UserRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; otherwise edit this user. */
  user: UserRow | null;
}

const STAFF_ROLES = staffRoleSchema.options;
const LOCALE_VALUES: Locale[] = [Locale.UZ, Locale.UZ_CYRL, Locale.RU, Locale.EN];

function phoneToUndefined(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  if (s === '') return undefined;
  return normalizePhone(s) ?? s;
}

export function UserDialog({ open, onOpenChange, user }: UserDialogProps) {
  const t = useTranslations('settings');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const branches = useAuthStore((s) => s.branches);
  const isEdit = user !== null;

  const form = useForm<CreateUserInput>({
    // Edit mode validates against the partial schema; the value shape is unchanged.
    resolver: (isEdit
      ? zodResolver(updateUserSchema)
      : zodResolver(createUserSchema)) as Resolver<CreateUserInput>,
    defaultValues: { fullName: '', password: '', role: 'RECEPTIONIST', branchIds: [], locale: Locale.UZ },
  });

  useEffect(() => {
    if (!open) return;
    if (user) {
      form.reset({
        fullName: user.fullName,
        phone: user.phone ?? undefined,
        email: user.email ?? undefined,
        password: undefined,
        role: user.role as CreateUserInput['role'],
        branchIds: user.branchIds,
        locale: user.locale,
      });
    } else {
      form.reset({
        fullName: '',
        password: '',
        role: 'RECEPTIONIST',
        branchIds: [],
        locale: Locale.UZ,
      });
    }
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: (values: CreateUserInput) => {
      if (user) {
        const body: UpdateUserInput = {
          fullName: values.fullName,
          phone: values.phone,
          email: values.email,
          role: values.role,
          branchIds: values.branchIds,
          locale: values.locale,
        };
        if (values.password) body.password = values.password;
        return settingsApi.updateUser(user.id, body);
      }
      return settingsApi.createUser(values);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(isEdit ? t('users.updated') : t('users.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const role = form.watch('role');
  const locale = form.watch('locale');
  const branchIds = form.watch('branchIds') ?? [];

  const toggleBranch = (id: string, checked: boolean) => {
    const next = checked ? [...branchIds, id] : branchIds.filter((b) => b !== id);
    form.setValue('branchIds', next, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('users.editTitle') : t('users.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="user-fullname">{t('users.fullName')}</Label>
            <Input id="user-fullname" autoComplete="off" {...form.register('fullName')} />
            {form.formState.errors.fullName ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="user-phone">{t('users.phone')}</Label>
              <Input
                id="user-phone"
                inputMode="tel"
                placeholder="+998 90 123-45-67"
                autoComplete="off"
                {...form.register('phone', { setValueAs: phoneToUndefined })}
              />
              {form.formState.errors.phone ? (
                <p className="text-sm text-destructive">{t('form.invalidPhone')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">{t('users.email')}</Label>
              <Input
                id="user-email"
                type="email"
                autoComplete="off"
                {...form.register('email', { setValueAs: emptyToUndefined })}
              />
              {form.formState.errors.email ? (
                <p className="text-sm text-destructive">{t('form.invalidEmail')}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-password">
              {isEdit ? t('users.newPassword') : t('users.password')}
            </Label>
            <PasswordInput
              id="user-password"
              autoComplete="new-password"
              {...form.register('password', isEdit ? { setValueAs: emptyToUndefined } : undefined)}
            />
            {form.formState.errors.password ? (
              <p className="text-sm text-destructive">{t('users.passwordHint')}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('users.passwordHint')}</p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('users.role')}</Label>
              <Select
                value={role}
                onValueChange={(v) =>
                  form.setValue('role', v as CreateUserInput['role'], { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('form.select')} />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {enumLabel('role', r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('users.locale')}</Label>
              <Select
                value={locale ?? undefined}
                onValueChange={(v) => form.setValue('locale', v as Locale, { shouldDirty: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('form.select')} />
                </SelectTrigger>
                <SelectContent>
                  {LOCALE_VALUES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`locales.${l.replace('-', '_')}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('users.branches')}</Label>
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border p-3">
              {branches.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={branchIds.includes(b.id)}
                    onCheckedChange={(v) => toggleBranch(b.id, v === true)}
                  />
                  {b.name}
                </label>
              ))}
            </div>
            {form.formState.errors.branchIds ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
