'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Plus, Search, ShieldCheck, UserPen } from 'lucide-react';
import { toast } from 'sonner';
import { UserStatus, staffRoleSchema } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { settingsApi, type UserRow } from '../api';
import { useApiErrorToast, useHasPermission } from '../hooks';
import { PermissionsDialog } from './permissions-dialog';
import { UserDialog } from './user-dialog';

const ALL = 'ALL';
const STAFF_ROLES = staffRoleSchema.options;
const STATUS_VALUES = Object.values(UserStatus);

export function UsersTab() {
  const t = useTranslations('settings');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useHasPermission('users.write');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<UserRow | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [statusChange, setStatusChange] = useState<{ user: UserRow; status: UserStatus } | null>(
    null,
  );

  const query = useMemo(
    () => ({
      page,
      search: search.trim() || undefined,
      role: role === ALL ? undefined : role,
      status: status === ALL ? undefined : status,
    }),
    [page, search, role, status],
  );

  const usersQuery = useQuery({
    queryKey: ['users', query],
    queryFn: () => settingsApi.listUsers(query),
    placeholderData: keepPreviousData,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: UserStatus }) =>
      settingsApi.updateUserStatus(id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('users.statusChanged'));
      setStatusChange(null);
    },
    onError: errorToast,
  });

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: t('users.fullName'),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'phone',
        header: t('users.phone'),
        cell: ({ row }) => row.original.phone ?? '—',
      },
      {
        accessorKey: 'role',
        header: t('users.role'),
        cell: ({ row }) => enumLabel('role', row.original.role),
      },
      {
        accessorKey: 'status',
        header: t('users.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} group="user" />,
      },
      {
        id: 'overrides',
        header: t('users.overrides'),
        cell: ({ row }) => {
          const o = row.original.permissionOverrides;
          const n = o.grant.length + o.revoke.length;
          return n > 0 ? (
            <span className="text-sm text-muted-foreground">{t('users.overridesCount', { count: n })}</span>
          ) : (
            '—'
          );
        },
      },
      ...(canWrite
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: UserRow } }) => {
                const user = row.original;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingUser(user);
                          setDialogOpen(true);
                        }}
                      >
                        <UserPen className="h-4 w-4" />
                        {t('users.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setPermissionsUser(user);
                          setPermissionsOpen(true);
                        }}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        {t('users.permissions')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {user.status !== UserStatus.ACTIVE ? (
                        <DropdownMenuItem
                          onClick={() => setStatusChange({ user, status: UserStatus.ACTIVE })}
                        >
                          {t('users.activate')}
                        </DropdownMenuItem>
                      ) : null}
                      {user.status !== UserStatus.SUSPENDED ? (
                        <DropdownMenuItem
                          onClick={() => setStatusChange({ user, status: UserStatus.SUSPENDED })}
                        >
                          {t('users.suspend')}
                        </DropdownMenuItem>
                      ) : null}
                      {user.status !== UserStatus.ARCHIVED ? (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setStatusChange({ user, status: UserStatus.ARCHIVED })}
                        >
                          {t('users.archive')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              },
            } satisfies ColumnDef<UserRow>,
          ]
        : []),
    ],
    [t, canWrite, enumLabel],
  );

  const meta = usersQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder={t('users.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('users.role')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('users.allRoles')}</SelectItem>
            {STAFF_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {enumLabel('role', r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('users.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('users.allStatuses')}</SelectItem>
            {STATUS_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {enumLabel('user', s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canWrite ? (
          <Button
            className="ml-auto"
            onClick={() => {
              setEditingUser(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('users.add')}
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={usersQuery.data?.data ?? []}
        meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
        onPageChange={setPage}
        isLoading={usersQuery.isLoading}
        emptyText={t('users.empty')}
      />

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} user={editingUser} />
      <PermissionsDialog
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
        user={permissionsUser}
      />
      <ConfirmDialog
        open={statusChange !== null}
        onOpenChange={(o) => {
          if (!o) setStatusChange(null);
        }}
        title={t('users.statusConfirmTitle')}
        description={t('users.statusConfirmDesc', {
          name: statusChange?.user.fullName ?? '',
          status: statusChange ? enumLabel('user', statusChange.status) : '',
        })}
        confirmLabel={t('form.confirm')}
        cancelLabel={t('form.cancel')}
        destructive={statusChange?.status !== UserStatus.ACTIVE}
        onConfirm={() => {
          if (statusChange) {
            statusMutation.mutate({ id: statusChange.user.id, status: statusChange.status });
          }
        }}
      />
    </div>
  );
}
