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

/** Trial/plan state of the clinic — mirrors the API's SubscriptionState. */
export interface SubscriptionInfo {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;
  planCode: string | null;
  planName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  isTrial: boolean;
  /** The clinic is read-only until the subscription is renewed. */
  isExpired: boolean;
}

/** Where a locked-out clinic should turn. */
export interface SupportContact {
  phone: string | null;
  telegram: string | null;
}

/** GET /auth/me — the single session payload the whole app bootstraps from. */
export interface MeResponse {
  user: AuthUser;
  clinic: ClinicInfo | null;
  branches: BranchInfo[];
  subscription: SubscriptionInfo | null;
  support: SupportContact;
}

interface AuthState {
  user: AuthUser | null;
  clinic: ClinicInfo | null;
  branches: BranchInfo[];
  subscription: SubscriptionInfo | null;
  support: SupportContact;
  accessToken: string | null;
  activeBranchId: string | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  setSession: (s: MeResponse & { accessToken: string }) => void;
  setAccessToken: (t: string) => void;
  setActiveBranch: (id: string) => void;
  /** Flip to read-only when the API reports SUBSCRIPTION_EXPIRED mid-session. */
  markExpired: () => void;
  clear: () => void;
}

const NO_SUPPORT: SupportContact = { phone: null, telegram: null };

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      clinic: null,
      branches: [],
      subscription: null,
      support: NO_SUPPORT,
      accessToken: null,
      activeBranchId: null,
      status: 'loading',
      setSession: ({ user, clinic, branches, subscription, support, accessToken }) => {
        const current = get().activeBranchId;
        const valid = branches.some((b) => b.id === current);
        set({
          user,
          clinic,
          branches,
          subscription: subscription ?? null,
          support: support ?? NO_SUPPORT,
          accessToken,
          status: 'authenticated',
          activeBranchId: valid ? current : (branches[0]?.id ?? null),
        });
      },
      setAccessToken: (accessToken) => set({ accessToken }),
      setActiveBranch: (activeBranchId) => set({ activeBranchId }),
      markExpired: () => {
        const sub = get().subscription;
        if (!sub || sub.isExpired) return;
        set({ subscription: { ...sub, isExpired: true, daysLeft: 0 } });
      },
      clear: () =>
        set({
          user: null,
          clinic: null,
          branches: [],
          subscription: null,
          support: NO_SUPPORT,
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
