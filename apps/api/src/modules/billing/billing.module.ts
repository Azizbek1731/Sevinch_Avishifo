import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { LabModule } from '../lab/lab.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { BalanceService } from './balance.service';
import { BalanceController, DebtorsController } from './balance.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseCategoriesController, ExpensesController } from './expenses.controller';
import { WebhooksController } from './webhooks.controller';
import { PaymeProvider } from './providers/payme.provider';
import { ClickProvider } from './providers/click.provider';
import { UzumProvider } from './providers/uzum.provider';
import { FISCALIZATION_SERVICE, NoopFiscalizationService } from './fiscalization.service';

/** Billing, invoicing & payments (spec §M8). */
@Module({
  imports: [ServicesModule, LabModule, NotificationsModule],
  controllers: [
    InvoicesController,
    ShiftsController,
    BalanceController,
    DebtorsController,
    ExpenseCategoriesController,
    ExpensesController,
    WebhooksController,
  ],
  providers: [
    InvoicesService,
    ShiftsService,
    BalanceService,
    ExpensesService,
    PaymeProvider,
    ClickProvider,
    UzumProvider,
    { provide: FISCALIZATION_SERVICE, useClass: NoopFiscalizationService },
  ],
  exports: [InvoicesService],
})
export class BillingModule {}
