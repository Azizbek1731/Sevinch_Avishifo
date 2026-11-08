'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Banknote,
  BedDouble,
  Building2,
  ClipboardList,
  CreditCard,
  Activity,
  FlaskConical,
  LayoutDashboard,
  Menu,
  MessageSquareHeart,
  Receipt,
  ScrollText,
  Scissors,
  Settings,
  Sparkles,
  ShieldCheck,
  Stethoscope,
  LifeBuoy,
  Tags,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  NAV_RULES,
  PLATFORM_NAV_RULES,
  isNavVisible,
  type NavKey,
} from '@/lib/nav-access';

const NAV_ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  ai: Sparkles,
  reception: ClipboardList,
  doctor: Stethoscope,
  patients: Users,
  admissions: BedDouble,
  surgeries: Scissors,
  recordAccess: ShieldCheck,
  cashier: CreditCard,
  invoices: Receipt,
  expenses: Banknote,
  lab: FlaskConical,
  uzi: Activity,
  services: Tags,
  staff: UserRound,
  reports: BarChart3,
  feedback: MessageSquareHeart,
  audit: ScrollText,
  settings: Settings,
  help: LifeBuoy,
  clinics: Building2,
  plans: Tags,
  analytics: BarChart3,
};

function NavLink({
  href,
  icon: Icon,
  active,
  label,
  onNavigate,
}: {
  href: string;
  icon: LucideIcon;
  active: boolean;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
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

  return {
    user,
    mainItems:
      !user || user.role === 'SUPER_ADMIN'
        ? []
        : NAV_RULES.filter((rule) => isNavVisible(rule, user)),
    platformItems:
      user?.role === 'SUPER_ADMIN'
        ? PLATFORM_NAV_RULES.filter((rule) => isNavVisible(rule, user))
        : [],
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
          href={item.href}
          icon={NAV_ICONS[item.key]}
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
              href={item.href}
              icon={NAV_ICONS[item.key]}
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
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 shrink-0 md:hidden"
          aria-label={t('menu')}
        >
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
