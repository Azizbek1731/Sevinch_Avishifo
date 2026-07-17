import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { QueueService } from './queue.service';
import { CallNextBodyDto, EnqueueDto, QueueQueryDto, ReorderTicketDto, SetPriorityDto, TransferTicketDto } from './dto';

@ApiTags('queue')
@ApiBearerAuth()
@Controller('queues')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  /** Queues (with tickets) for a branch — defaults to today (Asia/Tashkent). */
  @Get()
  @RequirePermissions('queue.read')
  list(@Query() query: QueueQueryDto) {
    return this.queue.getQueues(query);
  }

  /** Full ticket snapshot of today's queues for a branch (all statuses). */
  @Get('snapshot')
  @RequirePermissions('queue.read')
  async snapshot(@Query() query: QueueQueryDto) {
    return { branchId: query.branchId, tickets: await this.queue.getSnapshot(query.branchId) };
  }

  /** Add a walk-in (or checked-in appointment) to today's queue. */
  @Post('enqueue')
  @RequirePermissions('queue.manage')
  enqueue(@Body() body: EnqueueDto) {
    return this.queue.enqueue(body);
  }

  @Post(':queueId/call-next')
  @RequirePermissions('queue.call')
  callNext(@Param('queueId') queueId: string, @Body() body: CallNextBodyDto) {
    return this.queue.callNext(queueId, { roomId: body.roomId });
  }

  @Post('tickets/:id/start')
  @RequirePermissions('queue.call')
  start(@Param('id') id: string) {
    return this.queue.start(id);
  }

  @Post('tickets/:id/finish')
  @RequirePermissions('queue.call')
  finish(@Param('id') id: string) {
    return this.queue.finish(id);
  }

  @Post('tickets/:id/skip')
  @RequirePermissions('queue.call')
  skip(@Param('id') id: string) {
    return this.queue.skip(id);
  }

  @Post('tickets/:id/recall')
  @RequirePermissions('queue.call')
  recall(@Param('id') id: string) {
    return this.queue.recall(id);
  }

  @Patch('tickets/:id/reorder')
  @RequirePermissions('queue.manage')
  reorder(@Param('id') id: string, @Body() body: ReorderTicketDto) {
    return this.queue.reorder(id, body.position);
  }

  @Patch('tickets/:id/transfer')
  @RequirePermissions('queue.manage')
  transfer(@Param('id') id: string, @Body() body: TransferTicketDto) {
    return this.queue.transfer(id, body.targetDoctorUserId);
  }

  @Patch('tickets/:id/priority')
  @RequirePermissions('queue.manage')
  setPriority(@Param('id') id: string, @Body() body: SetPriorityDto) {
    return this.queue.setPriority(id, body.priority);
  }
}
