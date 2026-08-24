'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { useSession } from '@/stores/session';

/** Sonner paints its own surface and ignores our variables — tell it the theme. */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster richColors position="top-center" theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />;
}

export function Providers({ children }: { children: ReactNode }) {
  const hydrate = useSession((s) => s.hydrate);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
