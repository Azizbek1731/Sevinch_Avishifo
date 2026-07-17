import type {
  CreateLabOrderInput,
  CreateLabTestInput,
  EnterLabResultsInput,
  LabOrderStatus,
  UpdateLabTestInput,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';
import type {
  LabOrderDetail,
  LabOrderListItem,
  LabPrintPayload,
  LabTest,
  PatientHit,
} from './types';

export interface LabOrdersQuery {
  status?: LabOrderStatus;
  branchId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const labApi = {
  listOrders: (q: LabOrdersQuery): Promise<ApiResult<LabOrderListItem[]>> =>
    api.get<LabOrderListItem[]>('/lab-orders', {
      status: q.status,
      branchId: q.branchId,
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
    api.get<LabTest[]>('/lab-tests', { search: search || undefined, limit: 100 }),

  createTest: (body: CreateLabTestInput): Promise<ApiResult<LabTest>> =>
    api.post<LabTest>('/lab-tests', body),

  updateTest: (id: string, body: UpdateLabTestInput): Promise<ApiResult<LabTest>> =>
    api.patch<LabTest>(`/lab-tests/${id}`, body),

  searchPatients: (search: string): Promise<ApiResult<PatientHit[]>> =>
    api.get<PatientHit[]>('/patients', { search, limit: 8 }),
};
