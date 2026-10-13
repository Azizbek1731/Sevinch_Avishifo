import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfigService } from '../../core/config/app-config.service';
import type { RecordAccessService } from '../record-access/record-access.service';
import type { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalAuthGuard } from './portal-auth.guard';

const config = { env: { SINGLE_CLINIC_MODE: true } } as AppConfigService;

describe('Telegram-only patient channel', () => {
  it('does not issue OTP or portal sessions in single-clinic mode', () => {
    const portal = { requestOtp: vi.fn(), verifyOtp: vi.fn() };
    const controller = new PortalController(
      portal as unknown as PortalService,
      {} as RecordAccessService,
      config,
    );
    expect(() => controller.requestOtp({ phone: '+998901234567' })).toThrow('Telegram');
    expect(() => controller.verify({ phone: '+998901234567', code: '123456' })).toThrow('Telegram');
    expect(portal.requestOtp).not.toHaveBeenCalled();
    expect(portal.verifyOtp).not.toHaveBeenCalled();
  });

  it('also blocks previously issued web sessions before reading any patient data', async () => {
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ typ: 'portal', sub: '+998901234567' }) };
    const guard = new PortalAuthGuard(jwt as unknown as JwtService, config);
    await expect(guard.canActivate({} as ExecutionContext)).rejects.toThrow('Telegram');
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('retains portal auth for deployments that explicitly enable multi-clinic mode', async () => {
    const jwt = { verifyAsync: vi.fn().mockResolvedValue({ typ: 'portal', sub: '+998901234567' }) };
    const request = { headers: { authorization: 'Bearer portal-token' }, portalPhone: undefined };
    const guard = new PortalAuthGuard(
      jwt as unknown as JwtService,
      { env: { SINGLE_CLINIC_MODE: false } } as AppConfigService,
    );
    expect(
      await guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext),
    ).toBe(true);
    expect(request.portalPhone).toBe('+998901234567');
  });
});
