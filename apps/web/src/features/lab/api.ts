import type {
  Biomaterial,
  CreateLabOrderInput,
  CreateLabTestInput,
  EnterLabResultsInput,
  ImportLabCatalogInput,
  LabCategory,
  LabOrderStatus,
  PhysiologicalState,
  UpdateLabTestInput,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';
import type {
  LabCatalogSummary,
  LabCatalogTest,
  LabImportResult,
  LabOrderDetail,
  LabOrderListItem,
  LabPrintPayload,
  LabTest,
  PatientHit,
} from './types';

export interface LabCatalogQuery {
  biomaterial?: Biomaterial;
  category?: LabCategory;
  search?: string;
  onlyNew?: boolean;
  page?: number;
  limit?: number;
}

export interface LabOrdersQuery {
  includeUnpaid?: boolean;
  status?: LabOrderStatus;
  branchId?: string;
  patientId?: string;
  visitId?: string;
  referringDoctorUserId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const labApi = {
  listOrders: (q: LabOrdersQuery): Promise<ApiResult<LabOrderListItem[]>> =>
    api.get<LabOrderListItem[]>('/lab-orders', {
      status: q.status,
      branchId: q.branchId,
      patientId: q.patientId,
      visitId: q.visitId,
      referringDoctorUserId: q.referringDoctorUserId,
      includeUnpaid: q.includeUnpaid,
      search: q.search || undefined,
      page: q.page,
      limit: q.limit,
    }),

  getOrder: (id: string): Promise<ApiResult<LabOrderDetail>> =>
    api.get<LabOrderDetail>(`/lab-orders/${id}`),

  createOrder: (body: CreateLabOrderInput): Promise<ApiResult<LabOrderDetail>> =>
    api.post<LabOrderDetail>('/lab-orders', body),

  updateStatus: (id: string, status: LabOrderStatus): Promise<ApiResult<LabOrderDetail>> =>
    api.post<LabOrderDetail>(`/lab-orders/${id}/status`, { status }),

  enterResults: (itemId: string, body: EnterLabResultsInput): Promise<ApiResult<LabOrderDetail>> =>
    api.post<LabOrderDetail>(`/lab-orders/items/${itemId}/results`, body),

  approve: (id: string): Promise<ApiResult<LabOrderDetail>> =>
    api.post<LabOrderDetail>(`/lab-orders/${id}/approve`),

  deliver: (id: string): Promise<ApiResult<LabOrderDetail>> =>
    api.post<LabOrderDetail>(`/lab-orders/${id}/deliver`),

  getPrintPayload: (id: string): Promise<ApiResult<LabPrintPayload>> =>
    api.get<LabPrintPayload>(`/lab-orders/${id}/print`),

  listTests: (search?: string): Promise<ApiResult<LabTest[]>> =>
    api.getAll<LabTest>('/lab-tests', { search: search || undefined }),

  createTest: (body: CreateLabTestInput): Promise<ApiResult<LabTest>> =>
    api.post<LabTest>('/lab-tests', body),

  updateTest: (id: string, body: UpdateLabTestInput): Promise<ApiResult<LabTest>> =>
    api.patch<LabTest>(`/lab-tests/${id}`, body),

  searchPatients: (search: string): Promise<ApiResult<PatientHit[]>> =>
    api.get<PatientHit[]>('/patients', { search, limit: 8 }),

  setOrderContext: (
    id: string,
    physiologicalState: PhysiologicalState | null,
  ): Promise<ApiResult<LabOrderDetail>> =>
    api.patch<LabOrderDetail>(`/lab-orders/${id}/context`, { physiologicalState }),

  listCatalog: (q: LabCatalogQuery): Promise<ApiResult<LabCatalogTest[]>> =>
    api.get<LabCatalogTest[]>('/lab-catalog', {
      biomaterial: q.biomaterial,
      category: q.category,
      search: q.search || undefined,
      onlyNew: q.onlyNew ? true : undefined,
      page: q.page,
      limit: q.limit ?? 50,
    }),

  catalogSummary: (): Promise<ApiResult<LabCatalogSummary>> =>
    api.get<LabCatalogSummary>('/lab-catalog/summary'),

  importCatalog: (body: ImportLabCatalogInput): Promise<ApiResult<LabImportResult>> =>
    api.post<LabImportResult>('/lab-catalog/import', body),
};
