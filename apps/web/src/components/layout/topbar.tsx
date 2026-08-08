'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Bell, Check, Globe, LogOut, Search, ShieldCheck, WifiOff } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InAppNotificationPayload } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PatientSearchCommand } from '@/components/patient-search-command';
import { MobileNav } from '@/components/layout/sidebar';
import { useState } from 'react';

interface InboxResponse {
  items: InAppNotificationPayload[];
  unreadCount: number;
}

function NotificationBell() {
  const t = useTranslations('common');
  const tNav = useTranslations('nav');
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: async () => (await api.get<InboxResponse>('/notifications/inbox', { limit: 10 })).data,
  });

  useSocketEvent('notification.new', () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] });
  });

  const unread = data?.unreadCount ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={tNav("notifications")}>
          <Bell className="h-5 w-5" />
          {unread > 0 ? (
            <Badge className="absolute -right-1 -top-1 h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
              {unread > 99 ? '99+' : unread}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[19rem] sm:w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{t('appName')}</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1 text-xs md:h-7"
              onClick={() =>
                void api.post('/notifications/inbox/read-all').then(() =>
                  queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] }),
                )
              }
            >
              <Check className="h-3 w-3" /> OK
            </Button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(data?.items ?? []).length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('noData')}</p>
        ) : (
          (data?.items ?? []).map((n) => (
            <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5 py-2">
              <span className="text-sm font-medium">{n.title}</span>
              <span className="text-xs text-muted-foreground">{n.body}</span>
              <span className="text-[10px] text-muted-foreground">{formatTz(n.createdAt)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const t = useTranslations('common');
  const tAuth = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { user, clinic, branches, activeBranchId, setActiveBranch, clear } = useAuthStore();
  const { connected } = useSocket();
  const [searchOpen, setSearchOpen] = useState(false);

  const initials = (user?.fullName ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // session cleanup is best-effort
    }
    disconnectSocket();
    clear();
    router.replace('/login');
  };

  return (
    <header className="flex h-14 items-center gap-1 border-b bg-card px-3 md:gap-2 md:px-4">
      <MobileNav />

      {branches.length > 0 ? (
        <Select value={activeBranchId ?? undefined} onValueChange={setActiveBranch}>
          <SelectTrigger className="w-36 min-w-0 text-sm md:w-44">
            <SelectValue placeholder={t('branch')} />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="truncate text-sm font-medium text-muted-foreground">{clinic?.name}</span>
      )}

      <Button
        variant="outline"
        className="ml-2 hidden w-64 justify-start gap-2 text-muted-foreground lg:flex"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="truncate">{t('search')}</span>
        <kbd className="ml-auto rounded border bg-muted px-1.5 text-[10px]">⌘K</kbd>
      </Button>
      <PatientSearchCommand open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="ml-auto flex shrink-0 items-center gap-0.5 md:gap-1">
        {!connected ? (
          <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2 py-1 text-xs text-warning-foreground">
            <WifiOff className="h-3 w-3" />
            <span className="hidden sm:inline">{t('offline')}</span>
          </span>
        ) : null}

        {/* Without a keyboard there is no ⌘K, so the narrow layout needs its own way in. */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          aria-label={t('search')}
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-5 w-5" />
        </Button>

        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="shrink-0 gap-2 px-1.5 md:px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-32 truncate text-sm md:inline">{user?.fullName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">{user?.fullName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Globe className="h-3.5 w-3.5" /> {tAuth('language')}
            </DropdownMenuLabel>
            {(
              [
                ['uz', "O'zbekcha (lotin)"],
                ['uz-Cyrl', 'Ўзбекча (кирилл)'],
                ['ru', 'Русский'],
                ['en', 'English'],
              ] as const
            ).map(([l, name]) => (
              <DropdownMenuItem
                key={l}
                className={l === locale ? 'font-semibold' : ''}
                onClick={() => router.replace(pathname, { locale: l })}
              >
                {name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/security">
                <ShieldCheck className="mr-2 h-4 w-4" /> {tAuth('security')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> {tAuth('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
