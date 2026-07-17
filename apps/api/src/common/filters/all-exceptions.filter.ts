import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ErrorCode, type ApiError } from '@avishifo/shared';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppException } from '../app.exception';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError['error'] = {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodValidationException) {
      status = 400;
      const zodError = exception.getZodError();
      const issues = zodError instanceof ZodError ? zodError.issues : [];
      body = {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      const message =
        typeof resp === 'string'
          ? resp
          : ((resp as { message?: string | string[] }).message?.toString() ?? exception.message);
      body = { code: STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR, message };
    } else {
      // Unknown error: log full stack, hide details from the client (no PHI leaks).
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const payload: ApiError = { success: false, error: body };
    res.status(status).json(payload);
  }
}
