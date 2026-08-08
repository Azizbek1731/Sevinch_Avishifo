'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LogIn, Menu, UserRound, X } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { portalBaseUrlFallback, resolvePortalBaseUrl } from '@/lib/portal-url';
import { AuthCta } from './auth-cta';
import { Logo } from './logo';
import { LOCALES } from './language-switcher';
import { PanelLink } from './panel-link';

/**
 * Phone navigation. Everything the header only shows from `md` up lives here
 * below it — the section links, the language list and both doors. Without it a
 * patient on a phone has no route to the portal at all.
 */
export function LandingMobileMenu({
  links,
}: {
  links: ReadonlyArray<{ href: string; key: string }>;
}) {
  const t = useTranslations('landing');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Same first-paint contract as the patient section: start from the build-time
  // fallback so the door is never a dead link, then refine it after mount.
  const [portal, setPortal] = useState(portalBaseUrlFallback);
  useEffect(() => setPortal(resolvePortalBaseUrl()), []);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:hidden"
          aria-label={t('nav.menu')}
        >
          <Menu className="h-6 w-6" />
        </Button>
      </SheetTrigger>

      {/* The sheet's built-in close control is a bare 16px icon — hide it and use
          one with a thumb-sized hit area instead. */}
      <SheetContent
        side="right"
        className="flex w-[88%] max-w-sm flex-col gap-0 p-0 [&>button]:hidden"
      >
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3 text-left">
          <SheetTitle>
            <Logo size="sm" />
          </SheetTitle>
          <button
            type="button"
            onClick={close}
            aria-label={t('nav.close')}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-11 w-11 shrink-0')}
          >
            <X className="h-5 w-5" />
          </button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <nav className="flex flex-col p-3">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={close}
                className="flex min-h-12 items-center rounded-lg px-3 text-base font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {t(l.key)}
              </a>
            ))}
          </nav>

          {/* A row of codes rather than four full-width rows: the names cost
              192px of a phone screen that the links and doors need more. */}
          <div className="border-t border-border p-3">
            <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('nav.language')}
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  aria-label={l.name}
                  onClick={() => {
                    router.replace(pathname, { locale: l.code });
                    close();
                  }}
                  className={cn(
                    'flex h-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors',
                    l.code === locale
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {l.short}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border p-4">
          <AuthCta
            anonymousLabel={t('nav.trialCta')}
            onClick={close}
            showArrow={false}
            className="h-12 w-full text-base font-semibold"
          />
          <Button
            asChild
            className="h-12 w-full bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
          >
            <a href={portal ? `${portal}/login` : '#patient'} onClick={close}>
              <UserRound className="h-4 w-4" />
              {t('nav.patient')}
            </a>
          </Button>
          <PanelLink
            path="login"
            onClick={close}
            className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full text-base font-semibold')}
          >
            <LogIn className="h-4 w-4" />
            {t('nav.login')}
          </PanelLink>
        </div>
      </SheetContent>
    </Sheet>
  );
}
