'use client';

import type {
  CreateInpatientRoomInput,
  UpdateInpatientRoomInput,
} from '@avishifo/shared';
import { api, type ApiResult } from '@/lib/api-client';

export interface InpatientRoomRow {
  id: string;
  branchId: string;
  floor: number;
  number: string;
  name: string | null;
  capacity: number;
  pricePerDay: string;
  isActive: boolean;
  occupied: number;
  available: number;
  createdAt: string;
  updatedAt: string;
}

export const inpatientRoomsApi = {
  list: (q?: {
    branchId?: string;
    floor?: number;
    activeOnly?: boolean;
    limit?: number;
  }): Promise<ApiResult<InpatientRoomRow[]>> =>
    api.get<InpatientRoomRow[]>('/inpatient-rooms', { limit: 100, ...q }),
  create: (body: CreateInpatientRoomInput) =>
    api.post<InpatientRoomRow>('/inpatient-rooms', body),
  update: (id: string, body: UpdateInpatientRoomInput) =>
    api.patch<InpatientRoomRow>(`/inpatient-rooms/${id}`, body),
  deactivate: (id: string) => api.delete<InpatientRoomRow>(`/inpatient-rooms/${id}`),
};

export function inpatientRoomLabel(room: Pick<InpatientRoomRow, 'floor' | 'number' | 'name'>): string {
  const base = `${room.floor}-etaj · ${room.number}`;
  return room.name ? `${base} (${room.name})` : base;
}
