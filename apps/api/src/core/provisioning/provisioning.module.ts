import { Global, Module } from '@nestjs/common';
import { ClinicProvisioningService } from './clinic-provisioning.service';

@Global()
@Module({
  providers: [ClinicProvisioningService],
  exports: [ClinicProvisioningService],
})
export class ProvisioningModule {}
