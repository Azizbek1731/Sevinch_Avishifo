import type {
  Biomaterial,
  Gender,
  LabCategory,
  LabOrderStatus,
  LabValueType,
  LocalizedNameInput,
  PhysiologicalState,
  ReferenceRangeInput,
  ResultFlag,
} from '@avishifo/shared';

export interface LabTestParameter {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
  valueType: LabValueType;
  referenceRanges: ReferenceRangeInput[];
  sortOrder: number;
  /** Set only on an order detail: the interval that applies to THAT patient. */
  matchedRange?: ReferenceRangeInput | null;
  /** True when the analyte has intervals but none covers this patient. */
  referenceMissing?: boolean;
  /** True when the missing interval is one the order's physiological state would select. */
  requiresState?: boolean;
}

export interface LabTest {
  id: string;
  code: string;
  name: LocalizedNameInput;
  specimenType: string | null;
  biomaterial: Biomaterial | null;
  category: LabCategory | null;
  catalogCode: string | null;
  serviceId: string | null;
  isActive: boolean;
  parameters: LabTestParameter[];
}

// ------------------------------------------------------------ standard catalogue

export interface LabCatalogParameter {
  id: string;
  code: string;
  name: LocalizedNameInput;
  unit: string | null;
  valueType: LabValueType;
  note: string | null;
  referenceRanges: ReferenceRangeInput[];
  sortOrder: number;
}

export interface LabCatalogTest {
  id: string;
  code: string;
  biomaterial: Biomaterial;
  category: LabCategory;
  name: LocalizedNameInput;
  specimenNote: string | null;
  parameterCount: number;
  /** Whether this clinic already carries a copy. */
  imported?: boolean;
  parameters: LabCatalogParameter[];
}

export interface LabCatalogSummary {
  total: number;
  importedCount: number;
  biomaterials: Array<{ value: Biomaterial; count: number }>;
  categories: Array<{ value: LabCategory; count: number }>;
}

export interface LabImportResult {
  created: number;
  updated: number;
  skipped: number;
  createdCodes: string[];
  updatedCodes: string[];
  skippedCodes: string[];
  missingCodes: string[];
}

export interface LabBilling {
  invoiceId: string;
  number: string;
  status: string;
  total: string;
  paidTotal: string;
  due: string;
}

export interface LabOrderListItem {
  id: string;
  branchId: string;
  orderNumber: string;
  patientId: string;
  visitId: string | null;
  referringDoctor: { id: string; fullName: string | null } | null;
  status: LabOrderStatus;
  canWork: boolean;
  billing: LabBilling | null;
  itemCount: number;
  tests: Array<{ id: string; code: string; name: Record<string, string> }>;
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
  reportDocumentId: string | null;
  reportDocument: { id: string; title: string; fileName: string } | null;
  updatedAt: string | null;
  id: string;
  enteredById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  note: string | null;
  values: LabResultValue[];
}

export interface LabOrderItem {
  complete: boolean;
  id: string;
  labTestId: string;
  labTest: {
    id: string;
    code: string;
    name: LocalizedNameInput;
    specimenType: string | null;
    biomaterial: Biomaterial | null;
    category: LabCategory | null;
    parameters: LabTestParameter[];
  };
  result: LabResult | null;
}

export interface LabOrderDetail {
  canWork: boolean;
  billing: LabBilling | null;
  id: string;
  branchId: string;
  orderNumber: string;
  patientId: string;
  visitId: string | null;
  referringDoctor: { id: string; fullName: string | null } | null;
  status: LabOrderStatus;
  physiologicalState: PhysiologicalState | null;
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
  attachments: Array<{
    id: string;
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string | null;
  }>;
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
