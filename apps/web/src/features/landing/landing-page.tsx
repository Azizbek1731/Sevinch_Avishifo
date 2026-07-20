'use client';

import { useEffect } from 'react';
import { LandingNav } from './components/landing-nav';
import { LandingHero } from './components/landing-hero';
import { LandingStats } from './components/landing-stats';
import { LandingFeatures } from './components/landing-features';
import { LandingHighlight } from './components/landing-highlight';
import { LandingRoles } from './components/landing-roles';
import { LandingBenefits } from './components/landing-benefits';
import { LandingPricing } from './components/landing-pricing';
import { LandingFinalCta } from './components/landing-final-cta';
import { LandingFooter } from './components/landing-footer';

/**
 * Public marketing landing page (served at `/[locale]`). Fully client-rendered
 * and never gated — the only auth-aware bit is the primary CTA target.
 */
export function LandingPage() {
  // Smooth in-page anchor scrolling, scoped to while the landing is mounted and
  // disabled when the visitor prefers reduced motion.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = document.documentElement;
    const previous = el.style.scrollBehavior;
    el.style.scrollBehavior = 'smooth';
    return () => {
      el.style.scrollBehavior = previous;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <LandingNav />
      <main className="flex-1">
        <LandingHero />
        <LandingStats />
        <LandingFeatures />
        <LandingHighlight />
        <LandingRoles />
        <LandingBenefits />
        <LandingPricing />
        <LandingFinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
