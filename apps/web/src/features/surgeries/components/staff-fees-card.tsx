"use client";

import { useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  addSurgeryStaffFeesSchema,
  formatUZS,
  fromTiyin,
  toTiyin,
  type AddSurgeryStaffFeesInput,
  type SurgeryStaffRole,
} from "@avishifo/shared";
import { createId } from "@/lib/id";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorToast } from "@/features/services/hooks";
import { surgeriesApi, type Surgery } from "../api";
import { useInvalidateSurgeries } from "../hooks";
import { identifySurgeryRequest, type SurgeryRequestKey } from "../request-key";

const ROLES: SurgeryStaffRole[] = ["SURGEON", "ANESTHESIOLOGIST", "NURSE"];

function StaffFeesForm({
  surgery,
  available,
  onClose,
}: {
  surgery: Surgery;
  available: SurgeryStaffRole[];
  onClose: () => void;
}) {
  const t = useTranslations("surgeries");
  const invalidate = useInvalidateSurgeries();
  const onError = useApiErrorToast();
  const request = useRef<SurgeryRequestKey | null>(null);
  const [discard, setDiscard] = useState(false);
  const form = useForm<AddSurgeryStaffFeesInput>({
    resolver: zodResolver(addSurgeryStaffFeesSchema),
    defaultValues: { idempotencyKey: createId(), items: [] },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });
  const items = form.watch("items");
  const total = items.reduce((sum, item) => {
    try {
      return /^\d{1,12}(?:\.\d{1,2})?$/.test(item.amount)
        ? sum + toTiyin(item.amount)
        : sum;
    } catch {
      return sum;
    }
  }, 0n);
  const mutation = useMutation({
    mutationFn: (input: AddSurgeryStaffFeesInput) => {
      request.current = identifySurgeryRequest(
        input.items.map((item) => ({
          ...item,
          amount: fromTiyin(toTiyin(item.amount)),
          note: item.note?.trim() || undefined,
        })),
        request.current,
      );
      return surgeriesApi.addStaffFees(surgery.id, {
        ...input,
        idempotencyKey: request.current.key,
      });
    },
    onError,
    onSuccess: () => {
      invalidate();
      toast.success(t("staffFees.saved"));
      onClose();
    },
  });
  const close = () => {
    if (mutation.isPending) return;
    if (form.formState.isDirty) setDiscard(true);
    else onClose();
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("staffFees.add")}</DialogTitle>
            <DialogDescription>{t("staffFees.formHint")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
            className="space-y-4"
          >
            <fieldset disabled={mutation.isPending} className="space-y-3">
              {available.map((role) => {
                const index = fields.findIndex((field) => field.role === role);
                const selected = index >= 0;
                return (
                  <div key={role} className="rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`staff-role-${role}`}
                        checked={selected}
                        onCheckedChange={(checked) => {
                          if (checked && !selected)
                            append(
                              { role, amount: "", note: "" },
                              { shouldFocus: false },
                            );
                          else if (!checked && selected) remove(index);
                        }}
                      />
                      <Label
                        htmlFor={`staff-role-${role}`}
                        className="cursor-pointer font-medium"
                      >
                        {t(`staffFees.roles.${role}`)}
                      </Label>
                    </div>
                    {selected ? (
                      <div className="mt-4 space-y-3">
                        <input
                          type="hidden"
                          {...form.register(`items.${index}.role`)}
                        />
                        <div className="space-y-1.5">
                          <Label htmlFor={`staff-amount-${role}`}>
                            {t("amount")}
                          </Label>
                          <Input
                            id={`staff-amount-${role}`}
                            inputMode="decimal"
                            placeholder="0"
                            maxLength={15}
                            {...form.register(`items.${index}.amount`, {
                              setValueAs: (value: string) =>
                                value.trim().replace(",", "."),
                            })}
                            aria-invalid={Boolean(
                              form.formState.errors.items?.[index]?.amount,
                            )}
                            aria-describedby={
                              form.formState.errors.items?.[index]?.amount
                                ? `staff-amount-error-${role}`
                                : undefined
                            }
                          />
                          {form.formState.errors.items?.[index]?.amount ? (
                            <p
                              id={`staff-amount-error-${role}`}
                              className="text-xs text-destructive"
                            >
                              {t("staffFees.invalidAmount")}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`staff-note-${role}`}>
                            {t("note")}
                          </Label>
                          <Textarea
                            id={`staff-note-${role}`}
                            rows={2}
                            maxLength={500}
                            {...form.register(`items.${index}.note`)}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-primary/5 p-4">
              <span className="text-sm font-medium">
                {t("staffFees.addedTotal")}
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatUZS(fromTiyin(total))}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("staffFees.payoutSeparation")}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={close}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || fields.length === 0}
              >
                {mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("staffFees.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t("batch.discardTitle")}
        description={t("batch.discardHint")}
        cancelLabel={t("batch.keepEditing")}
        confirmLabel={t("batch.discard")}
        destructive
        onConfirm={onClose}
      />
    </>
  );
}

export function SurgeryStaffFeesCard({
  surgery,
  canRecord,
}: {
  surgery: Surgery;
  canRecord: boolean;
}) {
  const t = useTranslations("surgeries");
  const [open, setOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const invalidate = useInvalidateSurgeries();
  const onError = useApiErrorToast();
  const fees = surgery.staffFees;
  const available = ROLES.filter(
    (role) =>
      !fees.some((fee) => fee.role === role && fee.status !== "CANCELLED"),
  );
  const remove = useMutation({
    mutationFn: () => surgeriesApi.removeStaffFee(surgery.id, removeId!),
    onError,
    onSuccess: () => {
      invalidate();
      setRemoveId(null);
      toast.success(t("saved"));
    },
  });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            {t("staffFees.title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("staffFees.hint")}</p>
        </div>
        {canRecord && available.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("staffFees.add")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {fees.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {t("staffFees.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("staffFees.role")}</TableHead>
                <TableHead className="text-right">{t("amount")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t("remove")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.map((fee) => (
                <TableRow
                  key={fee.id}
                  className={
                    fee.status === "CANCELLED" ? "text-muted-foreground" : ""
                  }
                >
                  <TableCell>
                    <p
                      className={
                        fee.status === "CANCELLED"
                          ? "line-through"
                          : "font-medium"
                      }
                    >
                      {t(`staffFees.roles.${fee.role}`)}
                    </p>
                    {fee.note ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                        {fee.note}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                    {formatUZS(fee.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`chargeStatus.${fee.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canRecord && fee.status === "PENDING" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("remove")}
                        disabled={remove.isPending}
                        onClick={() => setRemoveId(fee.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {fees.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("staffFees.payoutSeparation")}
          </p>
        ) : null}
      </CardContent>
      {open && canRecord ? (
        <StaffFeesForm
          surgery={surgery}
          available={available}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(value) => {
          if (!value && !remove.isPending) setRemoveId(null);
        }}
        title={t("staffFees.remove")}
        description={t("staffFees.removeHint")}
        cancelLabel={t("cancel")}
        confirmLabel={t("confirm")}
        destructive
        onConfirm={() => {
          if (!remove.isPending) remove.mutate();
        }}
      />
    </Card>
  );
}
