'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  FileCheck,
  FileSignature,
  FileText,
  FlaskConical,
  ScanLine,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, errorMessage } from '@/lib/api';
import type { PortalDocument } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader, Spinner } from '@/components/spinner';

const CATEGORY_LABELS: Record<string, string> = {
  ANALYSIS: 'Tahlil natijasi',
  IMAGING: 'Tasvir / rentgen',
  DISCHARGE: 'Chiqish xulosasi',
  CONSENT: 'Rozilik hujjati',
  OTHER: 'Boshqa hujjat',
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ANALYSIS: FlaskConical,
  IMAGING: ScanLine,
  DISCHARGE: FileCheck,
  CONSENT: FileSignature,
  OTHER: FileText,
};

/** Human-readable file size: bytes / KB / MB (one decimal for MB). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const authStatus = useRequireAuth();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const documentsQ = useQuery({
    queryKey: ['portal-documents'],
    queryFn: () => api.get<PortalDocument[]>('/portal/me/documents').then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  if (authStatus !== 'authed') return <PageLoader />;

  const handleDownload = async (doc: PortalDocument) => {
    setDownloadingId(doc.id);
    try {
      await downloadFile(`/portal/me/documents/${doc.id}/download`, doc.fileName);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Hujjatlarim</h1>

      {documentsQ.isPending && <PageLoader />}
      {documentsQ.isError && (
        <p className="text-sm text-red-600">{errorMessage(documentsQ.error)}</p>
      )}
      {documentsQ.data !== undefined &&
        (documentsQ.data.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="Hujjatlaringiz yo'q"
            description="Klinika yuklagan hujjatlar — tahlil natijalari, xulosalar, tasvirlar — shu yerda ko'rinadi"
          />
        ) : (
          <ul className="space-y-3">
            {documentsQ.data.map((doc) => {
              const Icon = CATEGORY_ICONS[doc.category] ?? FileText;
              const label = CATEGORY_LABELS[doc.category] ?? 'Boshqa hujjat';
              const isDownloading = downloadingId === doc.id;
              return (
                <li
                  key={doc.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{doc.title}</p>
                      <p className="truncate text-sm text-slate-500">
                        {doc.clinicName} · {label} · {formatDate(doc.createdAt)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">{formatBytes(doc.sizeBytes)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      disabled={isDownloading}
                      aria-label={`${doc.title} — yuklab olish`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-brand hover:text-brand disabled:opacity-60"
                    >
                      {isDownloading ? (
                        <Spinner className="h-5 w-5" />
                      ) : (
                        <Download className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
