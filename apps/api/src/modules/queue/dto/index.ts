import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  enqueueSchema,
  idSchema,
  queueQuerySchema,
  reorderTicketSchema,
  TicketPriority,
  transferTicketSchema,
} from '@avishifo/shared';

export class EnqueueDto extends createZodDto(enqueueSchema) {}
export class QueueQueryDto extends createZodDto(queueQuerySchema) {}
export class ReorderTicketDto extends createZodDto(reorderTicketSchema) {}
export class TransferTicketDto extends createZodDto(transferTicketSchema) {}

/** REST body for POST /queues/:queueId/call-next — queueId travels in the path. */
const callNextBodySchema = z.object({ roomId: idSchema.optional() });
export class CallNextBodyDto extends createZodDto(callNextBodySchema) {}

/** PATCH /queues/tickets/:id/priority body. */
const setPrioritySchema = z.object({ priority: z.nativeEnum(TicketPriority) });
export class SetPriorityDto extends createZodDto(setPrioritySchema) {}
