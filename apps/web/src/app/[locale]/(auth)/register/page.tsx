import { RegisterForm } from '@/features/auth/register-form';

/** Trial length shown in the sign-up copy; keep in sync with the API's TRIAL_DAYS. */
const TRIAL_DAYS = Number(process.env.NEXT_PUBLIC_TRIAL_DAYS ?? 7);

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <RegisterForm trialDays={TRIAL_DAYS} />
    </main>
  );
}
