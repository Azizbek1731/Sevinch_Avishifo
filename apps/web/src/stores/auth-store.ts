'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@avishifo/shared';

export interface ClinicInfo {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface BranchInfo {
  id: string;
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  clinic: ClinicInfo | null;
  branches: BranchInfo[];
  accessToken: string | null;
  activeBranchId: string | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  setSession: (s: {
    user: AuthUser;
    clinic: ClinicInfo | null;
    branches: BranchInfo[];
    accessToken: string;
  }) => void;
  setAccessToken: (t: string) => void;
  setActiveBranch: (id: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      clinic: null,
      branches: [],
      accessToken: null,
      activeBranchId: null,
      status: 'loading',
      setSession: ({ user, clinic, branches, accessToken }) => {
        const current = get().activeBranchId;
        const valid = branches.some((b) => b.id === current);
        set({
          user,
          clinic,
          branches,
          accessToken,
          status: 'authenticated',
          activeBranchId: valid ? current : (branches[0]?.id ?? null),
        });
      },
      setAccessToken: (accessToken) => set({ accessToken }),
      setActiveBranch: (activeBranchId) => set({ activeBranchId }),
      clear: () =>
        set({
          user: null,
          clinic: null,
          branches: [],
          accessToken: null,
          status: 'anonymous',
        }),
    }),
    {
      name: 'avishifo-auth',
      // Access token stays in memory only; persist just the branch selection.
      partialize: (s) => ({ activeBranchId: s.activeBranchId }) as Partial<AuthState>,
    },
  ),
);
