'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ServiceKind } from '@avishifo/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { servicesApi, type ServiceCategoryRow } from '../api';
import { useApiErrorToast, useCanWriteServices } from '../hooks';

interface CategoryDraft {
  name: string;
  kind: ServiceKind;
}

const EMPTY_DRAFT: CategoryDraft = { name: '', kind: ServiceKind.CONSULTATION };

interface CategoryFormRowProps {
  draft: CategoryDraft;
  onChange: (draft: CategoryDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function CategoryFormRow({ draft, onChange, onSave, onCancel, saving }: CategoryFormRowProps) {
  const t = useTranslations('services');
  return (
    <div className="space-y-2 rounded-md border p-2">
      <Input
        value={draft.name}
        placeholder={t('categories.namePlaceholder')}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave();
          }
        }}
        autoFocus
      />
      <Select
        value={draft.kind}
        onValueChange={(v) => onChange({ ...draft, kind: v as ServiceKind })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.values(ServiceKind).map((k) => (
            <SelectItem key={k} value={k}>
              {t(`kinds.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving || !draft.name.trim()}>
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export interface CategorySidebarProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function CategorySidebar({ selectedId, onSelect }: CategorySidebarProps) {
  const t = useTranslations('services');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const canWrite = useCanWriteServices();

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<CategoryDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CategoryDraft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<ServiceCategoryRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['service-categories'],
    queryFn: () => servicesApi.listCategories(),
  });
  const categories = data?.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['service-categories'] });
    void queryClient.invalidateQueries({ queryKey: ['services'] });
  };

  const createMutation = useMutation({
    mutationFn: (draft: CategoryDraft) =>
      servicesApi.createCategory({ name: draft.name.trim(), kind: draft.kind }),
    onSuccess: () => {
      invalidate();
      toast.success(t('categories.created'));
      setAdding(false);
      setAddDraft(EMPTY_DRAFT);
    },
    onError: errorToast,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: CategoryDraft }) =>
      servicesApi.updateCategory(id, { name: draft.name.trim(), kind: draft.kind }),
    onSuccess: () => {
      invalidate();
      toast.success(t('categories.updated'));
      setEditingId(null);
    },
    onError: errorToast,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.deleteCategory(id),
    onSuccess: (_res, id) => {
      invalidate();
      toast.success(t('categories.deleted'));
      if (selectedId === id) onSelect(null);
      setDeleteTarget(null);
    },
    onError: errorToast,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t('categories.title')}</p>
        {canWrite ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdding((v) => !v);
              setAddDraft(EMPTY_DRAFT);
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              'flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
              selectedId === null && 'bg-muted font-medium',
            )}
          >
            {t('categories.all')}
          </button>

          {categories.map((cat) =>
            editingId === cat.id ? (
              <CategoryFormRow
                key={cat.id}
                draft={editDraft}
                onChange={setEditDraft}
                saving={updateMutation.isPending}
                onCancel={() => setEditingId(null)}
                onSave={() => updateMutation.mutate({ id: cat.id, draft: editDraft })}
              />
            ) : (
              <div
                key={cat.id}
                className={cn(
                  'group flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-sm hover:bg-muted',
                  selectedId === cat.id && 'bg-muted',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(cat.id)}
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span
                    className={cn('truncate', selectedId === cat.id && 'font-medium')}
                  >
                    {cat.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(`kinds.${cat.kind}`)}</span>
                </button>
                {canWrite ? (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingId(cat.id);
                        setEditDraft({ name: cat.name, kind: cat.kind });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteTarget(cat)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ),
          )}

          {categories.length === 0 && !adding ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('categories.empty')}</p>
          ) : null}

          {adding ? (
            <CategoryFormRow
              draft={addDraft}
              onChange={setAddDraft}
              saving={createMutation.isPending}
              onCancel={() => setAdding(false)}
              onSave={() => createMutation.mutate(addDraft)}
            />
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('categories.deleteTitle')}
        description={t('categories.deleteDescription', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('actions.delete')}
        cancelLabel={t('actions.cancel')}
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
