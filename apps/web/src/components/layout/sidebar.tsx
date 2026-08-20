'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Banknote,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Menu,
  MessageSquareHeart,
  Receipt,
  ScrollText,
  Settings,
  Sparkles,
  ShieldCheck,
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
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

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
  { key: 'ai', href: '/ai', icon: Sparkles, permissions: ['ai.use'] },
  { key: 'reception', href: '/reception', icon: ClipboardList, permissions: ['queue.manage'] },
  { key: 'doctor', href: '/doctor', icon: Stethoscope, permissions: ['queue.call'], roles: ['DOCTOR'] },
  { key: 'queue', href: '/queue', icon: ListOrdered, permissions: ['queue.read'] },
  { key: 'patients', href: '/patients', icon: Users, permissions: ['patients.read'] },
  {
    key: 'recordAccess',
    href: '/patients/record-access',
    icon: ShieldCheck,
    permissions: ['patients.recordAccess.manage'],
  },
  { key: 'calendar', href: '/appointments', icon: CalendarDays, permissions: ['appointments.read'] },
  { key: 'cashier', href: '/cashier', icon: CreditCard, permissions: ['payments.create'] },
  { key: 'invoices', href: '/invoices', icon: Receipt, permissions: ['invoices.read'] },
  { key: 'expenses', href: '/expenses', icon: Banknote, permissions: ['expenses.read'] },
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

function NavLink({
  item,
  active,
  label,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-base font-medium transition-colors md:min-h-0 md:text-sm',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="h-5 w-5 shrink-0 md:h-4 md:w-4" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * The one nav definition. The desktop rail and the mobile drawer both read it,
 * so a permission change lands in both without being written twice.
 */
function useNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const visible = (items: NavItem[]) =>
    items.filter((item) => {
      if (!user) return false;
      if (item.roles && !item.roles.includes(user.role)) {
        if (!item.permissions) return false;
      }
      if (!item.permissions) return true;
      return item.permissions.some((p) => user.permissions.includes(p));
    });

  return {
    user,
    mainItems: !user || user.role === 'SUPER_ADMIN' ? [] : visible(NAV_ITEMS),
    platformItems: user?.role === 'SUPER_ADMIN' ? PLATFORM_ITEMS : [],
    isActive: (href: string) => pathname === href || pathname.startsWith(`${href}/`),
  };
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const { mainItems, platformItems, isActive } = useNav();

  return (
    <nav className="flex flex-col gap-1">
      {mainItems.map((item) => (
        <NavLink
          key={item.key}
          item={item}
          active={isActive(item.href)}
          label={t(item.key as never)}
          onNavigate={onNavigate}
        />
      ))}
      {platformItems.length > 0 ? (
        <>
          <p className="mt-2 px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
            {t('platform')}
          </p>
          {platformItems.map((item) => (
            <NavLink
              key={item.key}
              item={item}
              active={isActive(item.href)}
              label={t(item.key as never)}
              onNavigate={onNavigate}
            />
          ))}
        </>
      ) : null}
    </nav>
  );
}

export function Sidebar() {
  const { user } = useNav();
  if (!user) return null;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center border-b px-4">
        <Logo size="sm" />
      </div>
      <ScrollArea className="flex-1 px-3 py-3">
        <NavList />
      </ScrollArea>
    </aside>
  );
}

/** The phone's only way between sections; the topbar renders it beside the logo. */
export function MobileNav() {
  const t = useTranslations('nav');
  const { user } = useNav();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-1 shrink-0 md:hidden" aria-label={t('menu')}>
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
        <SheetTitle className="sr-only">{t('menu')}</SheetTitle>
        <div className="flex h-14 shrink-0 items-center border-b px-4">
          <Logo size="sm" />
        </div>
        <ScrollArea className="flex-1 px-3 py-3">
          <NavList onNavigate={() => setOpen(false)} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
