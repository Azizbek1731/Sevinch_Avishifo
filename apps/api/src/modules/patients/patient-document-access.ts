import type { Prisma } from '@prisma/client';

/** Patient-facing uploads: analyser attachments stay private until explicitly signed. */
export function patientDocumentVisibility(patientIds: string[]): Prisma.PatientDocumentWhereInput {
  return {
    patientId: { in: patientIds },
    patient: { deletedAt: null },
    OR: [
      { labOrderId: null },
      {
        labOrder: { status: { in: ['APPROVED', 'DELIVERED'] } },
        labResults: {
          some: {
            approvedById: { not: null },
            approvedAt: { not: null },
            orderItem: { order: { patientId: { in: patientIds }, status: { in: ['APPROVED', 'DELIVERED'] } } },
          },
        },
      },
    ],
  };
}
