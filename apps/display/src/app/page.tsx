'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { readDisplayToken, saveDisplayToken } from '@/lib/storage';

/**
 * Setup screen. `?token=...` in the URL stores the display token and jumps
 * straight to the board; otherwise a form asks for the token with clear
 * instructions on where to get it. The board bounces back here with
 * `?error=auth|no-token` when the token is missing or rejected.
 */
export default function SetupPage() {
  const router = useRouter();
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken !== null && urlToken.trim().length > 0) {
      saveDisplayToken(urlToken.trim());
      router.replace('/board');
      return;
    }

    const errorCode = params.get('error');
    if (errorCode === 'auth') {
      setError('Displey tokeni yaroqsiz yoki muddati tugagan. Klinika panelidan yangi token oling.');
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

  if (checking) return <div className="h-screen" />;

  return (
    <main className="flex h-screen items-center justify-center px-6">
      <div className="w-full max-w-3xl rounded-[2.5rem] border border-white/10 bg-slate-900/70 p-14 shadow-2xl backdrop-blur-sm">
        <BrandMark subtitle="Navbat monitori" />

        <h1 className="mt-10 text-5xl font-black tracking-tight">Displeyni ulash</h1>
        <p className="mt-3 text-2xl text-slate-400">
          Ushbu ekranni klinika navbat tizimiga bir marta ulang.
        </p>

        {error !== null ? (
          <p className="mt-8 rounded-2xl border border-red-500/40 bg-red-500/10 px-6 py-5 text-xl text-red-300">
            {error}
          </p>
        ) : null}

        <ol className="mt-10 space-y-4">
          {[
            'Klinika panelida: Sozlamalar → Filiallar → «TV displey tokeni» ni oching.',
            'Ochilgan QR-kodni telefoningizda skanerlang va manzilni shu TV brauzerida oching — yoki tokenni nusxalab quyiga joylashtiring.',
            'Ekran avtomatik ishga tushadi. Keyinchalik ⚙ tugmasi (yoki S tugmasi) orqali tokenni almashtirishingiz mumkin.',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xl font-bold text-brand-bright ring-1 ring-brand/40">
                {i + 1}
              </span>
              <span className="text-xl leading-relaxed text-slate-300">{step}</span>
            </li>
          ))}
        </ol>

        <form onSubmit={handleSubmit} className="mt-10">
          <label className="mb-3 block text-lg font-semibold uppercase tracking-widest text-slate-500">
            Displey tokeni
          </label>
          <textarea
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            rows={3}
            autoFocus
            spellCheck={false}
            placeholder="Tokenni shu yerga joylashtiring…"
            className="w-full resize-none rounded-2xl border-2 border-white/10 bg-slate-950/60 px-5 py-4 font-mono text-lg text-slate-200 outline-none transition-colors focus:border-brand"
          />
          <button
            type="submit"
            className="mt-6 w-full rounded-2xl bg-brand py-5 text-3xl font-bold text-slate-950 transition-colors hover:bg-brand-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Boshlash
          </button>
        </form>
      </div>
    </main>
  );
}
