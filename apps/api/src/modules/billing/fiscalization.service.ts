import { Injectable, Logger } from '@nestjs/common';

/**
 * Clean stub interface for the future OFD (online cash register) integration
 * required by Uzbekistan fiscalization law (spec §M8). Billing calls
 * `registerReceipt` after an invoice becomes fully paid; swapping the provider
 * bound to FISCALIZATION_SERVICE is the only change needed for a real OFD.
 */
export interface FiscalizationService {
  registerReceipt(invoiceId: string): Promise<void>;
}

/** Nest injection token for the FiscalizationService implementation. */
export const FISCALIZATION_SERVICE = 'FISCALIZATION_SERVICE';

@Injectable()
export class NoopFiscalizationService implements FiscalizationService {
  private readonly logger = new Logger(NoopFiscalizationService.name);

  async registerReceipt(invoiceId: string): Promise<void> {
    // No-op until a real OFD provider is configured. Log id only (no PHI).
    this.logger.debug(`fiscalization noop: invoice ${invoiceId}`);
  }
}
