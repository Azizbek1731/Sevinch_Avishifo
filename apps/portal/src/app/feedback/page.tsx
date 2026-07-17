'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, LogIn, MessageSquareHeart } from 'lucide-react';
import { toast } from 'sonner';
import { submitFeedbackSchema } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/stores/session';
import { PageLoader, Spinner } from '@/components/spinner';
import { SectionCard } from '@/components/section-card';
import { StarRating } from '@/components/star-rating';

function FeedbackContent() {
  const searchParams = useSearchParams();
  const sessionStatus = useSession((s) => s.status);

  const token = searchParams.get('token');
  const visitId = searchParams.get('visitId');

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      const trimmed = comment.trim();
      if (token !== null && token !== '') {
        // Public feedback from an SMS link — no auth required.
        await api.post(
          '/feedback/public',
          { token, rating, ...(trimmed === '' ? {} : { comment: trimmed }) },
          { anonymous: true },
        );
      } else {
        const body = submitFeedbackSchema.parse({
          rating,
          ...(trimmed === '' ? {} : { comment: trimmed }),
          ...(visitId !== null && visitId !== '' ? { visitId } : {}),
        });
        await api.post('/portal/feedback', body);
      }
    },
    onSuccess: () => setSent(true),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (sent) {
    return (
      <div className="mx-auto max-w-sm py-10 text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
        <h1 className="mt-3 text-2xl font-bold">Rahmat!</h1>
        <p className="mt-1 text-slate-500">
          Fikringiz qabul qilindi. Xizmatlarimizni yaxshilashga yordam berganingiz uchun minnatdormiz.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-brand px-6 font-semibold text-white transition hover:bg-brand-dark"
        >
          Bosh sahifa
        </Link>
      </div>
    );
  }

  const isPublic = token !== null && token !== '';

  // Authed mode requires login.
  if (!isPublic) {
    if (sessionStatus === 'loading') return <PageLoader />;
    if (sessionStatus === 'guest') {
      const next = visitId !== null ? `/feedback?visitId=${visitId}` : '/feedback';
      return (
        <div className="mx-auto max-w-sm py-10 text-center">
          <MessageSquareHeart className="mx-auto h-14 w-14 text-brand" />
          <h1 className="mt-3 text-xl font-bold">Fikr bildirish uchun tizimga kiring</h1>
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-white transition hover:bg-brand-dark"
          >
            <LogIn className="h-4 w-4" />
            Kirish
          </Link>
        </div>
      );
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-center text-2xl font-bold">Xizmatni baholang</h1>
      <p className="mb-5 text-center text-sm text-slate-500">
        Tashrifingiz qanday o&apos;tdi? Fikringiz biz uchun muhim.
      </p>
      <SectionCard>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rating < 1) {
              toast.error('Avval bahoni tanlang');
              return;
            }
            submit.mutate();
          }}
          className="space-y-4"
        >
          <StarRating value={rating} onChange={setRating} />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder="Izoh (ixtiyoriy)"
            className="w-full rounded-xl border border-slate-300 bg-white p-3 text-base outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            type="submit"
            disabled={submit.isPending || rating < 1}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {submit.isPending ? <Spinner className="h-5 w-5 text-white" /> : 'Yuborish'}
          </button>
        </form>
      </SectionCard>
    </div>
  );
}

export default function FeedbackPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <FeedbackContent />
    </Suspense>
  );
}
