import type { ReactNode } from 'react';
import { AuthGate } from '@/components/layout/auth-gate';
import { PathGuard } from '@/components/layout/path-guard';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { SubscriptionBanner } from '@/features/subscription/components/subscription-banner';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <PathGuard>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <SubscriptionBanner />
            <main className="flex-1 overflow-x-hidden p-4 md:p-6">{children}</main>
          </div>
        </div>
      </PathGuard>
    </AuthGate>
  );
}
