import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@avishifo/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PayrollService } from './payroll.service';
import { AccrualAdjustDto, CompensationRuleListQueryDto, CompensationRulePatchDto, CompensationRuleUpsertDto, GenerateAccrualsQueryDto, PayrollAccrualsQueryDto } from './dto';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('payroll')
@Controller()
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  // ------------------------------------------------------- compensation rules

  @Get('compensation-rules')
  @RequirePermissions('payroll.read')
  listRules(@Query() query: CompensationRuleListQueryDto) {
    return this.payroll.listRules(query);
  }

  @Post('compensation-rules')
  @RequirePermissions('payroll.write')
  createRule(@Body() body: CompensationRuleUpsertDto) {
    return this.payroll.createRule(body);
  }

  @Patch('compensation-rules/:id')
  @RequirePermissions('payroll.write')
  updateRule(@Param('id') id: string, @Body() body: CompensationRulePatchDto) {
    return this.payroll.updateRule(id, body);
  }

  @Delete('compensation-rules/:id')
  @RequirePermissions('payroll.write')
  deleteRule(@Param('id') id: string) {
    return this.payroll.deleteRule(id);
  }

  // ------------------------------------------------------------- accruals

  @Post('payroll/accruals/generate')
  @RequirePermissions('payroll.write')
  generate(@Query() query: GenerateAccrualsQueryDto) {
    return this.payroll.generateAccruals(query.period);
  }

  @Get('payroll/accruals')
  @RequirePermissions('payroll.read')
  async listAccruals(@Query() query: PayrollAccrualsQueryDto, @CurrentUser() user: AuthUser) {
    if (query.export === 'xlsx') {
      const buffer = await this.payroll.exportAccrualsXlsx(query, user);
      return new StreamableFile(buffer, {
        type: XLSX_MIME,
        disposition: `attachment; filename="payroll-${query.period}.xlsx"`,
      });
    }
    return this.payroll.listAccruals(query, user);
  }

  @Patch('payroll/accruals/:id')
  @RequirePermissions('payroll.write')
  adjustAccrual(@Param('id') id: string, @Body() body: AccrualAdjustDto) {
    return this.payroll.adjustAccrual(id, body);
  }
}
