'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useApiErrorToast } from '@/features/services/hooks';
import { expensesApi, type ExpenseCategoryRow } from '../api';

export interface CategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ExpenseCategoryRow[];
}

/**
 * Expense categories, managed where they are used.
 *
 * Removing one only deactivates it: expenses already filed under it keep their
 * label, so last quarter's report does not quietly change shape because someone
 * tidied the list today.
 */
export function CategoriesDialog({ open, onOpenChange, categories }: CategoriesDialogProps) {
  const t = useTranslations('expenses');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
  };

  const create = useMutation({
    mutationFn: (name: string) => expensesApi.createCategory({ name }),
    onSuccess: () => {
      setNewName('');
      toast.success(t('categoryCreated'));
      refresh();
    },
    onError: errorToast,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => expensesApi.updateCategory(id, { name }),
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
    onError: errorToast,
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => expensesApi.removeCategory(id),
    onSuccess: () => {
      toast.success(t('categoryRemoved'));
      refresh();
    },
    onError: errorToast,
  });

  const active = categories.filter((c) => c.isActive);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('categoriesTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) create.mutate(name);
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('categoryNamePlaceholder')}
            />
            <Button type="submit" size="icon" disabled={!newName.trim() || create.isPending}>
              <Plus className="h-4 w-4" />
              <span className="sr-only">{t('addCategory')}</span>
            </Button>
          </form>

          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {active.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">{t('noCategories')}</li>
            ) : (
              active.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  {editingId === c.id ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="h-8"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        disabled={!editingName.trim() || rename.isPending}
                        onClick={() => rename.mutate({ id: c.id, name: editingName.trim() })}
                      >
                        <Check className="h-4 w-4" />
                        <span className="sr-only">{t('save')}</span>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">{t('cancel')}</span>
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingName(c.name);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">{t('rename')}</span>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-destructive"
                        disabled={deactivate.isPending}
                        onClick={() => deactivate.mutate(c.id)}
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">{t('removeCategory')}</span>
                      </Button>
                    </>
                  )}
                </li>
              ))
            )}
          </ul>
          <p className="text-xs text-muted-foreground">{t('categoryRemoveHint')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
