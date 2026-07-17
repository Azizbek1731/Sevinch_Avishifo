'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FlaskConical,
  HeartPulse,
  LayoutDashboard,
  ListOrdered,
  MessageSquareHeart,
  Receipt,
  ScrollText,
  Settings,
  Stethoscope,
  Tags,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission, UserRole } from '@avishifo/shared';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Any of these permissions grants visibility. */
  permissions?: Permission[];
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, permissions: ['reports.read'] },
  { key: 'reception', href: '/reception', icon: ClipboardList, permissions: ['queue.manage'] },
  { key: 'doctor', href: '/doctor', icon: Stethoscope, permissions: ['queue.call'], roles: ['DOCTOR'] },
  { key: 'queue', href: '/queue', icon: ListOrdered, permissions: ['queue.read'] },
  { key: 'patients', href: '/patients', icon: Users, permissions: ['patients.read'] },
  { key: 'calendar', href: '/appointments', icon: CalendarDays, permissions: ['appointments.read'] },
  { key: 'cashier', href: '/cashier', icon: CreditCard, permissions: ['payments.create'] },
  { key: 'invoices', href: '/invoices', icon: Receipt, permissions: ['invoices.read'] },
  { key: 'lab', href: '/lab', icon: FlaskConical, permissions: ['lab.orders.read'] },
  { key: 'services', href: '/services', icon: Tags, permissions: ['services.write'] },
  { key: 'staff', href: '/staff', icon: UserRound, permissions: ['staff.read'] },
  { key: 'reports', href: '/reports', icon: BarChart3, permissions: ['reports.read'] },
  { key: 'feedback', href: '/feedback', icon: MessageSquareHeart, permissions: ['feedback.read'] },
  { key: 'audit', href: '/audit', icon: ScrollText, permissions: ['audit.read'] },
  { key: 'settings', href: '/settings', icon: Settings, permissions: ['clinic.settings.read'] },
];

const PLATFORM_ITEMS: NavItem[] = [
  { key: 'clinics', href: '/platform/clinics', icon: Building2, permissions: ['platform.clinics.read'] },
  { key: 'plans', href: '/platform/plans', icon: Tags, permissions: ['platform.plans.write'] },
  { key: 'analytics', href: '/platform/analytics', icon: BarChart3, permissions: ['platform.analytics.read'] },
];

function NavLink({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const visible = (items: NavItem[]) =>
    items.filter((item) => {
      if (item.roles && !item.roles.includes(user.role)) {
        if (!item.permissions) return false;
      }
      if (!item.permissions) return true;
      return item.permissions.some((p) => user.permissions.includes(p));
    });

  const mainItems = user.role === 'SUPER_ADMIN' ? [] : visible(NAV_ITEMS);
  const platformItems = user.role === 'SUPER_ADMIN' ? PLATFORM_ITEMS : [];
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <HeartPulse className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold tracking-tight">AviShifo</span>
      </div>
      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="flex flex-col gap-1">
          {mainItems.map((item) => (
            <NavLink key={item.key} item={item} active={isActive(item.href)} label={t(item.key as never)} />
          ))}
          {platformItems.length > 0 ? (
            <>
              <p className="mt-2 px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
                {t('platform')}
              </p>
              {platformItems.map((item) => (
                <NavLink key={item.key} item={item} active={isActive(item.href)} label={t(item.key as never)} />
              ))}
            </>
          ) : null}
        </nav>
      </ScrollArea>
    </aside>
  );
}
