'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  UserRole} from '@avishifo/shared';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
} from '@avishifo/shared';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { settingsApi, type UserRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface PermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
}

/**
 * Permissions whose plain label still leaves a real question — a one-line hint
 * appears under those, and only those. Everything else reads for itself, and a
 * second line on all fifty-nine would bury the eight that matter.
 */
const HINTED: readonly Permission[] = [
  'patients.delete',
  'patients.recordAccess.manage',
  'visits.read.all',
  'payments.void',
  'admissions.administer',
  'shifts.oversee',
  'records.viewDeleted',
  'ai.use',
];

/** next-intl splits message keys on dots, so a permission code becomes underscores. */
const msgKey = (p: Permission): string => p.replace(/\./g, '_');

/** Clinic-scope permissions grouped by module prefix (platform.* excluded). */
const GROUPS: { module: string; permissions: Permission[] }[] = (() => {
  const map = new Map<string, Permission[]>();
  for (const p of PERMISSIONS) {
    if (p.startsWith('platform.')) continue;
    const moduleName = p.split('.')[0] ?? p;
    const list = map.get(moduleName) ?? [];
    list.push(p);
    map.set(moduleName, list);
  }
  return [...map.entries()].map(([module, permissions]) => ({ module, permissions }));
})();

export function PermissionsDialog({ open, onOpenChange, user }: PermissionsDialogProps) {
  const t = useTranslations('settings');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();

  const roleDefaults = useMemo(() => {
    const role = (user?.role ?? null) as UserRole | null;
    return new Set<Permission>(role ? ROLE_PERMISSIONS[role] ?? [] : []);
  }, [user?.role]);

  /** Effective checked state per permission. */
  const [checked, setChecked] = useState<Set<Permission>>(new Set());

  useEffect(() => {
    if (!open || !user) return;
    const effective = new Set<Permission>(roleDefaults);
    for (const p of user.permissionOverrides.grant) effective.add(p as Permission);
    for (const p of user.permissionOverrides.revoke) effective.delete(p as Permission);
    setChecked(effective);
  }, [open, user, roleDefaults]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) return Promise.reject(new Error('no user'));
      const grant: string[] = [];
      const revoke: string[] = [];
      for (const group of GROUPS) {
        for (const p of group.permissions) {
          const isDefault = roleDefaults.has(p);
          const isChecked = checked.has(p);
          if (isChecked && !isDefault) grant.push(p);
          if (!isChecked && isDefault) revoke.push(p);
        }
      }
      return settingsApi.updatePermissionOverrides(user.id, { grant, revoke });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('permissions.saved'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const toggle = (p: Permission, value: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (value) next.add(p);
      else next.delete(p);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('permissions.title', { name: user?.fullName ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('permissions.desc', {
              role: user ? enumLabel('role', user.role) : '',
            })}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-4">
            {GROUPS.map((group) => (
              <div key={group.module} className="space-y-2">
                <p className="text-sm font-semibold">
                  {t(`permissions.modules.${group.module}` as never)}
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {group.permissions.map((p) => {
                    const isDefault = roleDefaults.has(p);
                    const key = msgKey(p);
                    return (
                      <label
                        key={p}
                        // The raw code stays reachable on hover for support, but it is
                        // not what a clinic owner should have to read to decide.
                        title={p}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          className="mt-0.5 shrink-0"
                          checked={checked.has(p)}
                          onCheckedChange={(v) => toggle(p, v === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block leading-snug">
                            {t(`permissions.labels.${key}` as never)}
                          </span>
                          {HINTED.includes(p) ? (
                            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                              {t(`permissions.hints.${key}` as never)}
                            </span>
                          ) : null}
                        </span>
                        {isDefault ? (
                          <Badge
                            variant="outline"
                            className="mt-0.5 shrink-0 text-[10px] text-muted-foreground"
                          >
                            {t('permissions.default')}
                          </Badge>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('form.cancel')}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
