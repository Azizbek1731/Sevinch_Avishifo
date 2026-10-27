'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Paperclip, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiErrorToast } from '@/features/reception/hooks';
import {
  clinicalOrdersApi,
  type ClinicalAttachment,
} from '@/features/clinical-orders/api';

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UziAttachments({
  orderId,
  attachments,
  canUpload,
}: {
  orderId: string;
  attachments: ClinicalAttachment[];
  canUpload: boolean;
}) {
  const t = useTranslations('uzi');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      return clinicalOrdersApi.uploadAttachment(orderId, form);
    },
    onSuccess: () => {
      toast.success(t('attachmentUploaded'));
      void queryClient.invalidateQueries({ queryKey: ['clinical-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: errorToast,
  });

  const download = async (a: ClinicalAttachment): Promise<void> => {
    setDownloading(a.id);
    try {
      const blob = await clinicalOrdersApi.downloadAttachment(orderId, a.id);
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
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {upload.isPending ? t('uploading') : t('upload')}
            </Button>
          </>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('attachmentsHint')}</p>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('attachmentsEmpty')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {attachments.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{file.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {file.fileName} · {sizeText(file.sizeBytes)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={downloading === file.id}
                  onClick={() => void download(file)}
                >
                  {t('download')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
