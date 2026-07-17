import { HttpException } from '@nestjs/common';
import { ErrorCode } from '@avishifo/shared';

/**
 * Domain error with a machine-readable stable code (spec §8).
 * throw new AppException(ErrorCode.PATIENT_NOT_FOUND, 'Patient not found', 404);
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status = 400,
    readonly details?: unknown[],
  ) {
    super({ code, message, details }, status);
  }
}
