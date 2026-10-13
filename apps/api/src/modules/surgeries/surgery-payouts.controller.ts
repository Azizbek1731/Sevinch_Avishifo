import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createSurgeryPayoutSchema,
  voidSurgeryPayoutSchema,
  type AuthUser,
} from '@avishifo/shared';
import { ActiveBranch, CurrentUser, RequirePermissions } from '../../common/decorators';
import { SurgeryPayoutsService } from './surgery-payouts.service';

class CreateSurgeryPayoutDto extends createZodDto(createSurgeryPayoutSchema) {}
class VoidSurgeryPayoutDto extends createZodDto(voidSurgeryPayoutSchema) {}

@ApiTags('surgeries')
@Controller('surgeries/:surgeryId/payouts')
export class SurgeryPayoutsController {
  constructor(private readonly payouts: SurgeryPayoutsService) {}

  @Post()
  @RequirePermissions('surgery.payout')
  create(
    @Param('surgeryId') id: string,
    @Body() dto: CreateSurgeryPayoutDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.payouts.create(id, dto, user, branchId);
  }

  @Post(':payoutId/void')
  @RequirePermissions('surgery.payout')
  void(
    @Param('surgeryId') id: string,
    @Param('payoutId') payoutId: string,
    @Body() dto: VoidSurgeryPayoutDto,
    @CurrentUser() user: AuthUser,
    @ActiveBranch() branchId: string,
  ) {
    return this.payouts.void(id, payoutId, dto, user, branchId);
  }
}
