import type { Prisma } from '@prisma/client';

/** Patient-facing uploads: analyser / UZI attachments stay private until signed or completed. */
export function patientDocumentVisibility(patientIds: string[]): Prisma.PatientDocumentWhereInput {
  return {
    patientId: { in: patientIds },
    patient: { deletedAt: null },
    OR: [
      { labOrderId: null, clinicalOrderId: null },
      {
        labOrder: { status: { in: ['APPROVED', 'DELIVERED'] } },
        labResults: {
          some: {
            approvedById: { not: null },
            approvedAt: { not: null },
            orderItem: {
              order: {
                patientId: { in: patientIds },
                status: { in: ['APPROVED', 'DELIVERED'] },
              },
            },
          },
        },
      },
      {
        clinicalOrder: {
          patientId: { in: patientIds },
          visit: { status: 'COMPLETED' },
        },
      },
    ],
  };
}
