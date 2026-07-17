'use client';

import { create } from 'zustand';
import { clearToken, getToken, setToken } from '@/lib/api';

export type SessionStatus = 'loading' | 'guest' | 'authed';

interface SessionState {
  /** Normalized +998XXXXXXXXX of the logged-in patient (known after OTP login). */
  phone: string | null;
  token: string | null;
  status: SessionStatus;
  /** Read the persisted token from localStorage (call once on mount). */
  hydrate: () => void;
  login: (phone: string, token: string) => void;
  logout: () => void;
}

export const useSession = create<SessionState>((set) => ({
  phone: null,
  token: null,
  status: 'loading',
  hydrate: () => {
    const token = getToken();
    set({ token, status: token ? 'authed' : 'guest' });
  },
  login: (phone, token) => {
    setToken(token);
    set({ phone, token, status: 'authed' });
  },
  logout: () => {
    clearToken();
    set({ phone: null, token: null, status: 'guest' });
  },
}));
