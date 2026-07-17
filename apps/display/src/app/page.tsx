'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { readDisplayToken, saveDisplayToken } from '@/lib/storage';

/**
 * Setup screen. `?token=...` in the URL stores the display token and jumps
 * straight to the board; otherwise a minimal dark form asks for the token.
 * The board bounces back here with `?error=auth|no-token` when the token is
 * missing or rejected by the server.
 */
export default function SetupPage() {
  const router = useRouter();
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // window.location instead of useSearchParams: no Suspense requirement and
    // maximum smart-TV browser compatibility.
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken !== null && urlToken.trim().length > 0) {
      saveDisplayToken(urlToken.trim());
      router.replace('/board');
      return;
    }

    const errorCode = params.get('error');
    if (errorCode === 'auth') {
      setError('Displey tokeni yaroqsiz yoki muddati tugagan. Yangi token oling va qaytadan kiriting.');
    } else if (errorCode === 'no-token') {
      setError('Displey tokeni topilmadi. Davom etish uchun tokenni kiriting.');
    } else {
      // TV rebooted onto "/" with a saved token → go straight to the board.
      const saved = readDisplayToken();
      if (saved !== null) {
        router.replace('/board');
        return;
      }
    }
    setChecking(false);
  }, [router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const token = tokenInput.trim();
    if (token.length === 0) {
      setError('Tokenni kiriting.');
      return;
    }
    saveDisplayToken(token);
    router.replace('/board');
  };

  if (checking) {
    return <div className="h-screen bg-slate-950" />;
  }

  return (
    <main className="flex h-screen items-center justify-center bg-slate-950 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl rounded-3xl border-2 border-slate-800 bg-slate-900 p-12"
      >
        <h1 className="text-6xl font-black tracking-tight text-white">
          Avi<span className="text-emerald-400">Shifo</span>
        </h1>
        <p className="mt-3 text-2xl text-slate-400">Navbat monitori — displey tokenini kiriting</p>

        {error !== null ? (
          <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-xl text-red-400">
            {error}
          </p>
        ) : null}

        <textarea
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          rows={4}
          autoFocus
          spellCheck={false}
          placeholder="Displey tokenini shu yerga joylashtiring…"
          className="mt-8 w-full resize-none rounded-2xl border-2 border-slate-700 bg-slate-950 px-5 py-4 font-mono text-lg text-slate-200 outline-none focus:border-emerald-400"
        />

        <button
          type="submit"
          className="mt-8 w-full rounded-2xl bg-emerald-500 py-5 text-3xl font-bold text-slate-950 hover:bg-emerald-400"
        >
          Boshlash
        </button>
      </form>
    </main>
  );
}
