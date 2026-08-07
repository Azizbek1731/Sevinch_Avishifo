'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, UserRound } from 'lucide-react';
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

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useSession((s) => s.status);
  const logout = useSession((s) => s.logout);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  const handleLogout = () => {
    logout();
    queryClient.clear();
    toast.success('Tizimdan chiqdingiz');
    router.push('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
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
                  className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  <UserRound className="h-4 w-4" />
                  Kabinet
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  <LogOut className="h-4 w-4" />
                  Chiqish
                </button>
              </>
            )}
            {status === 'guest' && (
              <Link
                href="/login"
                className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
              >
                <LogIn className="h-4 w-4" />
                Kirish
              </Link>
            )}
          </div>
        </div>
        <nav className="-mb-px flex gap-1 overflow-x-auto pb-0" aria-label="Asosiy menyu">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
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
  );
}
