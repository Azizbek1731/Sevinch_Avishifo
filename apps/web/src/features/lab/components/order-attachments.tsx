'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Paperclip, Upload } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiErrorToast } from '../hooks';

export interface OrderAttachment {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string | null;
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Files off the bench: the analyser printout, a scanned form, a photographed
 * slip. They are stored as the patient's own documents (visible in Hujjatlar,
 * the portal and the bot) and linked here so the order shows what came with it.
 */
export function OrderAttachments({
  orderId,
  attachments,
  canUpload,
}: {
  orderId: string;
  attachments: OrderAttachment[];
  canUpload: boolean;
}) {
  const t = useTranslations('lab');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      return api.upload(`/lab-orders/${orderId}/attachments`, form);
    },
    onSuccess: () => {
      toast.success(t('attachmentUploaded'));
      void queryClient.invalidateQueries({ queryKey: ['lab', 'order', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: errorToast,
  });

  const download = async (a: OrderAttachment): Promise<void> => {
    setDownloading(a.id);
    try {
      const blob = await api.get<Blob>(`/lab-orders/${orderId}/attachments/${a.id}/download`);
      const url = URL.createObjectURL(blob.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('attachmentDownloadFailed'));
    } finally {
      setDownloading(null);
    }
  };

  if (attachments.length === 0 && !canUpload) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" />
          {t('attachmentsTitle')}
        </CardTitle>
        {canUpload ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-1 h-4 w-4" />
              {t('attachmentUpload')}
            </Button>
          </>
        ) : null}
      </CardHeader>
      <CardContent>
        {attachments.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('attachmentsEmpty')}</p>
        ) : (
          <ul className="divide-y">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{a.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {sizeText(a.sizeBytes)}
                      {a.createdAt ? ` · ${formatTz(a.createdAt)}` : ''}
                    </span>
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={downloading === a.id}
                  onClick={() => void download(a)}
                >
                  {t('attachmentDownload')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
