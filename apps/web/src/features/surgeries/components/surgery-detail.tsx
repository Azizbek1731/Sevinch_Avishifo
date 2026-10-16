"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { formatUZS, voidSurgeryPayoutSchema } from "@avishifo/shared";
import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  Scissors,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/i18n/routing";
import { usePermissions } from "@/hooks/use-permissions";
import { formatTz } from "@/lib/dates";
import { localizedText } from "@/lib/localized";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useApiErrorToast } from "@/features/services/hooks";
import { surgeriesApi } from "../api";
import { useSurgery, useInvalidateSurgeries } from "../hooks";
import { SurgeryUsageForm } from "./usage-form";
import { SurgeryPayoutDialog } from "./payout-dialog";
import { SurgeryStaffFeesCard } from "./staff-fees-card";

export function SurgeryDetail({ id }: { id: string }) {
  const t = useTranslations("surgeries");
  const locale = useLocale();
  const can = usePermissions();
  const query = useSurgery(id, can("surgery.read"));
  const invalidate = useInvalidateSurgeries();
  const onError = useApiErrorToast();
  const [usageKind, setUsageKind] = useState<"MATERIAL" | "ANESTHESIA" | null>(
    null,
  );
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    kind: "complete" | "cancel" | "remove";
    entryId?: string;
  } | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const mutation = useMutation({
    mutationFn: (action: NonNullable<typeof confirmation>) =>
      action.kind === "complete"
        ? surgeriesApi.complete(id)
        : action.kind === "cancel"
          ? surgeriesApi.cancel(id)
          : surgeriesApi.removeEntry(id, action.entryId!),
    onError,
    onSuccess: () => {
      invalidate();
      setConfirmation(null);
      toast.success(t("saved"));
    },
  });
  const voidPayment = useMutation({
    mutationFn: () => surgeriesApi.voidPayout(id, voidId!, voidReason.trim()),
    onError,
    onSuccess: () => {
      invalidate();
      setVoidId(null);
      setVoidReason("");
      toast.success(t("payoutVoided"));
    },
  });
  if (!can("surgery.read"))
    return <EmptyState icon={Scissors} title={t("forbidden")} />;
  if (query.isLoading) return <Skeleton className="h-96" />;
  const surgery = query.data;
  if (!surgery || query.isError)
    return (
      <EmptyState
        icon={Scissors}
        title={t("loadError")}
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        }
      />
    );
  const activeAdmission = surgery.admission.status === "ACTIVE";
  const canRecord =
    can("surgery.record") && activeAdmission && surgery.status !== "CANCELLED";
  const activePayout = surgery.payouts.find((payment) => !payment.voidedAt);
  const mayCancel =
    can("surgery.schedule") &&
    activeAdmission &&
    surgery.status === "PLANNED" &&
    surgery.serviceCharge.status === "PENDING" &&
    surgery.entries.every((entry) => entry.status === "CANCELLED") &&
    surgery.staffFees.every((fee) => fee.status === "CANCELLED") &&
    !activePayout;
  const summary = [
    ["fee", surgery.feeAmount],
    ["materials", surgery.materialTotal],
    ["anesthesia", surgery.anesthesiaTotal],
    ["staffFees.total", surgery.staffFeeTotal],
    ["total", surgery.totalAmount],
  ] as const;
  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/surgeries">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("back")}
        </Link>
      </Button>
      <PageHeader
        title={localizedText(surgery.service.name, locale)}
        description={`${surgery.patient.fullName} · ${surgery.patient.mrn} · ${surgery.admission.historyNumber}`}
      >
        <Badge variant={surgery.status === "COMPLETED" ? "default" : "outline"}>
          {t(`status.${surgery.status}`)}
        </Badge>
        {canRecord && surgery.status === "PLANNED" ? (
          <Button
            disabled={mutation.isPending}
            onClick={() => setConfirmation({ kind: "complete" })}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {t("complete")}
          </Button>
        ) : null}
        {mayCancel ? (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setConfirmation({ kind: "cancel" })}
          >
            {t("cancelOperation")}
          </Button>
        ) : null}
      </PageHeader>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="space-y-1">
            <p className="font-medium">
              {t("surgeon")}: {surgery.surgeon.fullName}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("date")}: {surgery.scheduledDate.slice(0, 10)}
              {surgery.admission.ward ? ` · ${surgery.admission.ward}` : ""}
              {surgery.admission.bed
                ? ` · ${t("bed")} ${surgery.admission.bed}`
                : ""}
            </p>
            {surgery.note ? (
              <p className="whitespace-pre-wrap text-sm">{surgery.note}</p>
            ) : null}
          </div>
          {can("admissions.read") ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admissions/${surgery.admissionId}`}>
                {t("openAdmission")}
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {summary.map(([label, amount]) => (
          <Card
            key={label}
            className={
              label === "total" ? "border-primary/30 bg-primary/5" : ""
            }
          >
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{t(label)}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {formatUZS(amount)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {surgery.status === "CANCELLED" ? (
        <p className="rounded-lg border bg-muted p-3 text-sm">
          {t("cancelledHint")}
        </p>
      ) : !activeAdmission ? (
        <p className="rounded-lg border bg-muted p-3 text-sm">
          {t("closedAdmissionHint")}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("chargesHint")}</p>
      )}
      <SurgeryStaffFeesCard surgery={surgery} canRecord={canRecord} />
      {(["MATERIAL", "ANESTHESIA"] as const).map((kind) => {
        const entries = surgery.entries.filter((entry) => entry.kind === kind);
        return (
          <Card key={kind}>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">
                {t(kind === "MATERIAL" ? "materials" : "anesthesia")}
              </CardTitle>
              {canRecord ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setUsageKind(kind)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  {t(kind === "MATERIAL" ? "addMaterial" : "addAnesthesia")}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {entries.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {t("noEntries")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">
                          {t("itemName")}
                        </th>
                        <th className="p-2 text-right font-medium">
                          {t("quantity")}
                        </th>
                        <th className="p-2 text-right font-medium">
                          {t("unitPrice")}
                        </th>
                        <th className="p-2 text-right font-medium">
                          {t("lineTotal")}
                        </th>
                        <th className="p-2 font-medium">{t("statusLabel")}</th>
                        <th className="w-10">
                          <span className="sr-only">{t("remove")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`border-b last:border-0 ${entry.status === "CANCELLED" ? "text-muted-foreground" : ""}`}
                        >
                          <td className="py-3 pr-3">
                            <p
                              className={
                                entry.status === "CANCELLED"
                                  ? "line-through"
                                  : "font-medium"
                              }
                            >
                              {localizedText(entry.title, locale)}
                            </p>
                            {entry.note ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {entry.note}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap p-2 text-right tabular-nums">
                            {entry.quantity} {entry.unit}
                          </td>
                          <td className="whitespace-nowrap p-2 text-right tabular-nums">
                            {formatUZS(entry.unitPrice)}
                          </td>
                          <td className="whitespace-nowrap p-2 text-right font-medium tabular-nums">
                            {formatUZS(entry.lineTotal)}
                          </td>
                          <td className="p-2">
                            <Badge variant="outline">
                              {t(`chargeStatus.${entry.status}`)}
                            </Badge>
                          </td>
                          <td>
                            {canRecord && entry.status === "PENDING" ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={mutation.isPending}
                                aria-label={t("remove")}
                                onClick={() =>
                                  setConfirmation({
                                    kind: "remove",
                                    entryId: entry.id,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {can("surgery.payout") || surgery.payouts.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {t("surgeonPayments")}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("payoutHint")}
              </p>
            </div>
            {can("surgery.payout") &&
            surgery.status === "COMPLETED" &&
            !activePayout ? (
              <Button onClick={() => setPayoutOpen(true)}>
                <Wallet className="mr-2 h-4 w-4" />
                {t("paySurgeon")}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {surgery.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  surgery.status === "COMPLETED"
                    ? "noPayouts"
                    : "completeBeforePayout",
                )}
              </p>
            ) : (
              surgery.payouts.map((payout) => (
                <div
                  key={payout.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {payout.doctorName} · {formatUZS(payout.amount)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`methods.${payout.method}`)} ·{" "}
                      {formatTz(payout.paidAt)} ·{" "}
                      {payout.type === "PERCENT"
                        ? `${payout.value}% × ${formatUZS(payout.basisAmount)}`
                        : t("fixed")}
                    </p>
                    {payout.note ? (
                      <p className="mt-1 text-sm">{payout.note}</p>
                    ) : null}
                  </div>
                  {payout.voidedAt ? (
                    <Badge variant="outline">{t("voided")}</Badge>
                  ) : can("surgery.payout") ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setVoidId(payout.id);
                        setVoidReason("");
                      }}
                    >
                      {t("voidPayout")}
                    </Button>
                  ) : (
                    <Badge>{t("paidOut")}</Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
      {canRecord ? (
        <SurgeryUsageForm
          open={usageKind !== null}
          onOpenChange={(open) => {
            if (!open) setUsageKind(null);
          }}
          surgeryId={id}
          kind={usageKind ?? "MATERIAL"}
        />
      ) : null}
      {can("surgery.payout") ? (
        <SurgeryPayoutDialog
          surgery={surgery}
          open={payoutOpen}
          onOpenChange={setPayoutOpen}
        />
      ) : null}
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={t(
          confirmation?.kind === "complete"
            ? "complete"
            : confirmation?.kind === "cancel"
              ? "cancelOperation"
              : "remove",
        )}
        description={t(
          confirmation?.kind === "complete"
            ? "completeHint"
            : confirmation?.kind === "cancel"
              ? "cancelOperationHint"
              : "removeHint",
        )}
        cancelLabel={t("cancel")}
        confirmLabel={t("confirm")}
        destructive={confirmation?.kind !== "complete"}
        onConfirm={() => {
          if (confirmation && !mutation.isPending)
            mutation.mutate(confirmation);
        }}
      />
      <Dialog
        open={voidId !== null}
        onOpenChange={(open) => {
          if (!open && !voidPayment.isPending) setVoidId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("voidPayout")}</DialogTitle>
            <DialogDescription>{t("voidHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="void-reason">{t("reason")}</Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              maxLength={500}
              disabled={voidPayment.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={voidPayment.isPending}
              onClick={() => setVoidId(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                voidPayment.isPending ||
                !voidSurgeryPayoutSchema.safeParse({ reason: voidReason })
                  .success
              }
              onClick={() => voidPayment.mutate()}
            >
              {t("voidPayout")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
