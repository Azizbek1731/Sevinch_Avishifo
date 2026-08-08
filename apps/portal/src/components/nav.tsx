'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  FlaskConical,
  Home,
  LogIn,
  LogOut,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { LogoMark } from '@/components/logo-mark';
import { toast } from 'sonner';
import { useSession } from '@/stores/session';

const LINKS = [
  { href: '/', label: 'Bosh sahifa' },
  { href: '/me/appointments', label: 'Qabullarim' },
  { href: '/me/visits', label: 'Kasallik tarixi' },
  { href: '/me/results', label: 'Natijalarim' },
  { href: '/me/documents', label: 'Hujjatlarim' },
  { href: '/me/invoices', label: 'Hisoblarim' },
  { href: '/me/profile', label: 'Profil' },
] as const;

/**
 * The phone menu. Seven links in a horizontal scroller sat above the fold where
 * a thumb cannot comfortably reach them; these five live at the bottom instead.
 * Hujjatlar and Hisoblar stay one tap away from the cabinet and the profile.
 */
const TABS = [
  { href: '/me', label: 'Kabinet', icon: Home },
  { href: '/me/appointments', label: 'Qabullar', icon: CalendarDays },
  { href: '/me/visits', label: 'Tarix', icon: Stethoscope },
  { href: '/me/results', label: 'Natijalar', icon: FlaskConical },
  { href: '/me/profile', label: 'Profil', icon: UserRound },
] as const;

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useSession((s) => s.status);
  const logout = useSession((s) => s.logout);

  const isActive = (href: string) =>
    href === '/' || href === '/me'
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const handleLogout = () => {
    logout();
    queryClient.clear();
    toast.success('Tizimdan chiqdingiz');
    router.push('/');
  };

  // Booking, login and the clinic page are focused flows with their own actions
  // at the bottom of the screen — the tab bar would fight them there.
  const showTabBar = status === 'authed' && (pathname === '/' || pathname.startsWith('/me'));

  return (
    <>
      {/* viewport-fit=cover runs the page under the status bar in landscape and
          when installed to the home screen; the inset keeps the logo clear of it. */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="flex h-14 items-center justify-between gap-2">
            <Link href="/" className="flex min-h-11 items-center gap-2">
              <LogoMark className="h-8 w-8" />
              <span className="text-lg font-bold tracking-tight text-slate-900">
                Avi<span className="text-brand">Shifo</span>
              </span>
            </Link>
            <div className="flex items-center gap-1">
              {status === 'authed' && (
                <>
                  <Link
                    href="/me"
                    aria-label="Kabinet"
                    className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 sm:px-3"
                  >
                    <UserRound className="h-5 w-5" />
                    <span className="hidden sm:inline">Kabinet</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    aria-label="Chiqish"
                    className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 sm:px-3"
                  >
                    <LogOut className="h-5 w-5" />
                    <span className="hidden sm:inline">Chiqish</span>
                  </button>
                </>
              )}
              {status === 'guest' && (
                <Link
                  href="/login"
                  className="flex h-11 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  <LogIn className="h-4 w-4" />
                  Kirish
                </Link>
              )}
            </div>
          </div>
          <nav className="-mb-px hidden gap-1 md:flex" aria-label="Asosiy menyu">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition ${
                  isActive(link.href)
                    ? 'border-brand text-brand'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {showTabBar && (
        <nav
          aria-label="Tezkor menyu"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur print:hidden md:hidden"
        >
          <div className="mx-auto flex max-w-3xl">
            {TABS.map((tab) => {
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition ${
                    active ? 'text-brand' : 'text-slate-500'
                  }`}
                >
                  <tab.icon className="h-5 w-5" />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
