'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, FileText, Trash2, UploadCloud } from 'lucide-react';
import { DocumentCategory } from '@avishifo/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTz } from '@/lib/dates';
import { patientsApi, type PatientDocument } from '../api';
import { useApiErrorToast, usePatientDocuments, usePermissions } from '../hooks';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PatientDocumentsTab({ patientId }: { patientId: string }) {
  const t = useTranslations('patients');
  const can = usePermissions();
  const queryClient = useQueryClient();
  const toastError = useApiErrorToast();

  const [page, setPage] = useState(1);
  const query = usePatientDocuments(patientId, page);
  const documents = query.data?.data ?? [];
  const meta = query.data?.meta;
  const pageCount = meta ? Math.max(1, Math.ceil(meta.total / Math.max(1, meta.limit))) : 1;

  // Upload form state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(DocumentCategory.OTHER);
  const [deleteTarget, setDeleteTarget] = useState<PatientDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['patients', 'documents', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['patients', 'detail', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['patients', 'timeline', patientId] });
  };

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (file) form.append('file', file);
      form.append('category', category);
      form.append('title', title.trim());
      return patientsApi.uploadDocument(patientId, form);
    },
    onSuccess: () => {
      toast.success(t('documents.uploaded'));
      setFile(null);
      setTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      invalidate();
    },
    onError: toastError,
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => patientsApi.removeDocument(docId),
    onSuccess: () => {
      toast.success(t('documents.deletedDoc'));
      setDeleteTarget(null);
      invalidate();
    },
    onError: toastError,
  });

  const download = async (doc: PatientDocument) => {
    setDownloadingId(doc.id);
    try {
      const res = await patientsApi.downloadDocument(doc.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError(err);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {can('patients.documents.write') ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('documents.uploadTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (file && title.trim()) uploadMutation.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="doc-file">{t('documents.file')}</Label>
                <Input
                  id="doc-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                  className="w-64"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
                  }}
                />
              </div>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="doc-title">{t('documents.title')}</Label>
                <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('documents.category')}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(DocumentCategory).map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`docCategory.${c}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={!file || !title.trim() || uploadMutation.isPending}>
                <UploadCloud className="mr-1 h-4 w-4" />
                {t('documents.upload')}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState icon={FileText} title={t('documents.empty')} />
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {doc.fileName} · {formatSize(doc.sizeBytes)} · {formatTz(doc.createdAt)}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {t(`docCategory.${doc.category}` as never)}
                </Badge>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadingId === doc.id}
                  onClick={() => void download(doc)}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {t('documents.download')}
                </Button>
                {can('patients.documents.write') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(doc)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {meta && pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('documents.prev')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {meta.page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('documents.next')}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('documents.deleteTitle')}
        description={t('documents.deleteDesc', { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('card.delete')}
        cancelLabel={t('form.cancel')}
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
