'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { ApiError } from '@/lib/api-client';
import { AuthBootstrap } from '@/components/auth-bootstrap';
import { ThemedToaster } from '@/components/themed-toaster';

export function Providers({ children }: { children: ReactNode }) {
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

  return (
    // defaultTheme="system" so a clinic that never touches the setting still
    // follows the machine — the reception PCs are often set to dark at night.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap>{children}</AuthBootstrap>
        <ThemedToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
