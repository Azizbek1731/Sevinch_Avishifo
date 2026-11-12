import type { Prisma } from '@prisma/client';
import type { VisitReportPdfData } from './visit-report-pdf.service';

/** Same finalized clinical report in the staff panel, portal and Telegram. */
export const VISIT_REPORT_INCLUDE = {
  patient: true,
  doctor: {
    select: {
      fullName: true,
      phone: true,
      staffProfile: { select: { specialty: true } },
    },
  },
  diagnoses: { include: { icd10: true }, orderBy: { createdAt: 'asc' } },
  prescriptions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
  documents: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, title: true, fileName: true },
  },
  amendments: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true, authorId: true, reason: true },
  },
} satisfies Prisma.VisitInclude;

type VisitForReport = Prisma.VisitGetPayload<{ include: typeof VISIT_REPORT_INCLUDE }> & {
  kind?: string;
  reportTitle?: string | null;
  reportBody?: string | null;
};

export function buildVisitReportPdfData(
  visit: VisitForReport,
  clinic: VisitReportPdfData['clinic'],
  amendmentAuthor?: { fullName: string } | null,
): VisitReportPdfData {
  if (visit.status !== 'COMPLETED' || !visit.completedAt) {
    throw new Error('Only a confirmed visit may be exported as a patient report');
  }
  return {
    id: visit.id,
    kind: visit.kind === 'ULTRASOUND' ? 'ULTRASOUND' : 'CONSULTATION',
    title: visit.reportTitle ?? null,
    body: visit.reportBody ?? null,
    clinic,
    patient: {
      fullName: visit.patient.fullName,
      mrn: visit.patient.mrn,
      dob: visit.patient.dob?.toISOString().slice(0, 10) ?? null,
    },
    doctorName: visit.doctor.fullName,
    doctorSpecialty: visit.doctor.staffProfile?.specialty ?? null,
    doctorPhone: visit.doctor.phone ?? null,
    confirmedAt: visit.completedAt.toISOString(),
    latestAmendment: visit.amendments[0]
      ? {
          at: visit.amendments[0].createdAt.toISOString(),
          authorName: amendmentAuthor?.fullName ?? 'Klinika xodimi',
          reason: visit.amendments[0].reason,
        }
      : null,
    subjective: visit.subjective,
    objective: visit.objective,
    assessmentNote: visit.assessmentNote,
    plan: visit.plan,
    diagnosisPrimary: visit.diagnosisPrimary ?? null,
    diagnosisSecondary: visit.diagnosisSecondary ?? null,
    emptyConfirmReason: visit.emptyConfirmReason ?? null,
    documents: (visit.documents ?? []).map((doc) => ({
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName,
    })),
    physiotherapy: visit.physiotherapy ?? null,
    diagnoses: visit.diagnoses.map((item) => ({
      code: item.icd10.code,
      name: item.icd10.nameUz,
      note: item.note,
      primary: item.isPrimary,
    })),
    prescriptions: visit.prescriptions.map((item) => ({
      drugName: item.drugName,
      dosage: item.dosage,
      strength: item.strength,
      form: item.form,
      quantity: item.quantity,
      route: item.route,
      frequency: item.frequency,
      durationDays: item.durationDays,
      durationText: item.durationText,
      dripRate: item.dripRate,
      instructions: item.instructions,
      combineWithPrevious: item.combineWithPrevious,
      sortOrder: item.sortOrder,
    })),
  };
}
