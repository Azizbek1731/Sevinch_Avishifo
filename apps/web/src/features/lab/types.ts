import type {
  Gender,
  LabOrderStatus,
  LocalizedNameInput,
  ReferenceRangeInput,
  ResultFlag,
} from '@avishifo/shared';

export interface LabTestParameter {
  id: string;
  name: string;
  unit: string | null;
  referenceRanges: ReferenceRangeInput[];
  sortOrder: number;
}

export interface LabTest {
  id: string;
  code: string;
  name: LocalizedNameInput;
  specimenType: string | null;
  serviceId: string | null;
  isActive: boolean;
  parameters: LabTestParameter[];
}

export interface LabOrderListItem {
  id: string;
  branchId: string;
  orderNumber: string;
  patientId: string;
  visitId: string | null;
  status: LabOrderStatus;
  itemCount: number;
  collectedAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  patient: { id: string; fullName: string; mrn: string };
}

export interface LabResultValue {
  id: string;
  parameterId: string;
  value: string;
  flag: ResultFlag;
}

export interface LabResult {
  id: string;
  enteredById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  note: string | null;
  values: LabResultValue[];
}

export interface LabOrderItem {
  id: string;
  labTestId: string;
  labTest: {
    id: string;
    code: string;
    name: LocalizedNameInput;
    specimenType: string | null;
    parameters: LabTestParameter[];
  };
  result: LabResult | null;
}

export interface LabOrderDetail {
  id: string;
  branchId: string;
  orderNumber: string;
  patientId: string;
  visitId: string | null;
  status: LabOrderStatus;
  orderedById: string | null;
  collectedAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  patient: {
    id: string;
    mrn: string;
    fullName: string;
    dob: string | null;
    gender: Gender | null;
    phone: string | null;
  };
  items: LabOrderItem[];
}

export interface LabPrintPayload {
  clinic: {
    name: string;
    legalName: string | null;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
  };
  order: LabOrderDetail;
  approvedBy: { id: string; fullName: string } | null;
}

export interface PatientHit {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}
