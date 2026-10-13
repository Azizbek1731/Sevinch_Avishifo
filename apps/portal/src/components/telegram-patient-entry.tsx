import { FileText, FlaskConical, MessageCircle, Phone, ShieldCheck } from 'lucide-react';

/** This clinic serves patient records through its private Telegram bot. */
export function TelegramPatientEntry({ botUsername }: { botUsername?: string }) {
  const username = botUsername && /^[a-zA-Z0-9_]+$/.test(botUsername) ? botUsername : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-12">
      <section className="w-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <span className="inline-flex rounded-2xl bg-sky-50 p-3 text-sky-600">
          <MessageCircle className="h-8 w-8" />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">
          Natijalaringiz Telegramda
        </h1>
        <p className="mt-4 leading-relaxed text-slate-600">
          Laboratoriya natijalari, UZI va shifokor xulosalarini klinikaning Telegram botidan PDF
          ko‘rinishida oling.
        </p>
        <ol className="my-8 space-y-5 text-slate-700">
          <li className="flex gap-3">
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
            <span>
              Botni oching va <strong>Start</strong> tugmasini bosing.
            </span>
          </li>
          <li className="flex gap-3">
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
            <span>
              <strong>Raqamni yuborish</strong> tugmasi bilan o‘z telefon raqamingizni tasdiqlang.
            </span>
          </li>
          <li className="flex gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
            <span>Bemor kartangiz ulanadi. Kerakli natija yoki xulosani tanlang.</span>
          </li>
        </ol>
        {username ? (
          <a
            href={`https://t.me/${username}`}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 font-semibold text-white transition hover:bg-sky-700"
          >
            <MessageCircle className="h-5 w-5" /> Telegram botni ochish
          </a>
        ) : (
          <p className="rounded-xl bg-slate-50 p-4 text-slate-600">
            Bot manzilini qabulxonadan oling.
          </p>
        )}
        <div className="mt-6 space-y-3 border-t border-slate-100 pt-6 text-sm leading-relaxed text-slate-500">
          <p className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Telegram raqamingiz qabulxonada bemor kartasiga kiritilgan asosiy telefon raqami bilan
              bir xil bo‘lishi kerak.
            </span>
          </p>
          <p className="flex gap-2">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Natijalar mutaxassis tasdiqlagandan keyin ko‘rinadi.</span>
          </p>
        </div>
      </section>
    </main>
  );
}
