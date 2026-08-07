import { z } from 'zod';
import { RecordAccessStatus } from '../enums';

/**
 * Patient-side request to read their own clinical history (SOAP notes,
 * diagnoses, prescriptions) in the portal and the Telegram bot. Lab results are
 * never gated by this — a result belongs to the patient the moment it is
 * approved. What needs a human decision is the narrative record, because a
 * diagnosis read without a clinician present can do real harm.
 */
export const requestRecordAccessSchema = z.object({
  note: z.string().max(500).optional(),
});
export type RequestRecordAccessInput = z.infer<typeof requestRecordAccessSchema>;

export const decideRecordAccessSchema = z.object({
  /** REVOKED closes access the clinic previously granted. */
  status: z.enum([
    RecordAccessStatus.APPROVED,
    RecordAccessStatus.REJECTED,
    RecordAccessStatus.REVOKED,
  ]),
  note: z.string().max(500).optional(),
});
export type DecideRecordAccessInput = z.infer<typeof decideRecordAccessSchema>;

export const recordAccessListQuerySchema = z.object({
  status: z.nativeEnum(RecordAccessStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type RecordAccessListQuery = z.infer<typeof recordAccessListQuerySchema>;

/** What the patient sees about their own request. */
export interface RecordAccessStateDto {
  status: RecordAccessStatus | 'NONE';
  requestedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Convenience for the UI — true only while status is APPROVED. */
  canViewHistory: boolean;
}

/** What staff sees in the approvals inbox. */
export interface RecordAccessRequestDto {
  id: string;
  status: RecordAccessStatus;
  patientNote: string | null;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  patient: {
    id: string;
    mrn: string;
    fullName: string;
    /// Patients can be registered without a phone (walk-in, child card).
    phone: string | null;
  };
  decidedBy: { id: string; fullName: string } | null;
}
