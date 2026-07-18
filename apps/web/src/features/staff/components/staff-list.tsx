'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Search, Users } from 'lucide-react';
import { UserRole } from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useAuthStore } from '@/stores/auth-store';
import type { StaffMember } from '../api';
import { usePermissions, useStaffList } from '../hooks';
import { PayrollTab } from './payroll-tab';

const ALL = '__all__';
const PAGE_LIMIT = 20;

const STAFF_ROLES: UserRole[] = [
  UserRole.CLINIC_OWNER,
  UserRole.CLINIC_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.CASHIER,
  UserRole.LAB_TECH,
  UserRole.ACCOUNTANT,
];

function StaffDirectory() {
  const t = useTranslations('staff');
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const branches = useAuthStore((s) => s.branches);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [role, setRole] = useState<string>(ALL);
  const [branchId, setBranchId] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useStaffList({
    page,
    limit: PAGE_LIMIT,
    search: debouncedSearch || undefined,
    role: role === ALL ? undefined : (role as UserRole),
    branchId: branchId === ALL ? undefined : branchId,
  });

  const items = useMemo(() => query.data?.data ?? [], [query.data]);
  const meta = query.data?.meta;

  const columns = useMemo<ColumnDef<StaffMember>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: t('table.fullName'),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'role',
        header: t('table.role'),
        cell: ({ row }) => (
          <Badge variant="secondary" className="text-xs">
            {enumLabel('role', row.original.role)}
          </Badge>
        ),
      },
      {
        accessorKey: 'specialty',
        header: t('table.specialty'),
        cell: ({ row }) =>
          row.original.specialty ?? <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: 'branches',
        header: t('table.branches'),
        cell: ({ row }) =>
          row.original.branches.length > 0 ? (
            <span className="text-sm">
              {row.original.branches.map((b) => b.name).join(', ')}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'phone',
        header: t('table.phone'),
        cell: ({ row }) =>
          row.original.phone ? (
            <span className="whitespace-nowrap">{row.original.phone}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'status',
        header: t('table.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} group="user" />,
      },
    ],
    [t, enumLabel],
  );

  const showEmpty =
    !query.isLoading && items.length === 0 && !debouncedSearch && role === ALL && branchId === ALL;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            className="pl-8"
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
            <SelectValue placeholder={t('filters.role')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allRoles')}</SelectItem>
            {STAFF_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {enumLabel('role', r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {branches.length > 1 ? (
          <Select
            value={branchId}
            onValueChange={(v) => {
              setBranchId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t('filters.branch')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.allBranches')}</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {showEmpty ? (
        <EmptyState icon={Users} title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div
          className="[&_tbody_tr]:cursor-pointer"
          onClick={(e) => {
            if (query.isLoading) return;
            const target = e.target as HTMLElement;
            if (target.closest('a,button')) return;
            const tr = target.closest('tr');
            if (!tr || !tr.closest('tbody')) return;
            const index = Array.from(tr.parentElement?.children ?? []).indexOf(tr);
            const row = items[index];
            if (row) router.push(`/staff/${row.id}`);
          }}
        >
          <DataTable
            columns={columns}
            data={items}
            isLoading={query.isLoading}
            emptyText={t('empty.noResults')}
            meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

export function StaffList() {
  const t = useTranslations('staff');
  const can = usePermissions();
  const canPayroll = can('payroll.read');

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {canPayroll ? (
        <Tabs defaultValue="directory">
          <TabsList>
            <TabsTrigger value="directory">{t('tabs.directory')}</TabsTrigger>
            <TabsTrigger value="payroll">{t('tabs.payroll')}</TabsTrigger>
          </TabsList>
          <TabsContent value="directory" className="mt-4">
            <StaffDirectory />
          </TabsContent>
          <TabsContent value="payroll" className="mt-4">
            <PayrollTab />
          </TabsContent>
        </Tabs>
      ) : (
        <StaffDirectory />
      )}
    </div>
  );
}
