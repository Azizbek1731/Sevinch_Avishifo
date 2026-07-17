import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { AuditViewerService } from './audit-viewer.service';
import { AuditLogQueryDto } from './dto';

@ApiTags('audit-viewer')
@Controller('audit-logs')
export class AuditViewerController {
  constructor(private readonly auditViewer: AuditViewerService) {}

  @Get()
  @RequirePermissions('audit.read')
  list(@Query() query: AuditLogQueryDto) {
    return this.auditViewer.list(query);
  }

  @Get('entities')
  @RequirePermissions('audit.read')
  entities() {
    return this.auditViewer.entities();
  }
}
