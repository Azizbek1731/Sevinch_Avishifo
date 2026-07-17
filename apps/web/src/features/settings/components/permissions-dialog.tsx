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
import { settingsApi, type UserRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface PermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
}

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
              role: user ? t(`users.roles.${user.role}` as never) : '',
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
                    return (
                      <label
                        key={p}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked.has(p)}
                          onCheckedChange={(v) => toggle(p, v === true)}
                        />
                        <code className="font-mono text-xs">{p}</code>
                        {isDefault ? (
                          <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
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
