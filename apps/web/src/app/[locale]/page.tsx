import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LandingPage } from '@/features/landing/landing-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  return {
    // `absolute` opts out of the layout's "%s · AviShifo" title template.
    title: { absolute: t('meta.title') },
    description: t('meta.description'),
  };
}

export default async function IndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage />;
}
