import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import type { FreeSlot } from '../appointments/slots.service';
import { PortalAuthGuard, PortalPhone } from './portal-auth.guard';
import { PortalService } from './portal.service';
import {
  type PortalAppointmentDto,
  type PortalBookingResultDto,
  type PortalClinicDto,
  type PortalInvoiceDto,
  type PortalLabOrderDto,
  type PortalPatientCardDto,
  type PortalVisitDto,
  type PortalVisitDetailDto,
} from './portal.service';
import { PortalAppointmentsQueryDto, PortalBookDto, PortalCancelAppointmentDto, PortalFeedbackDto, PortalListQueryDto, PortalRequestOtpDto, PortalSlotsQueryDto, PortalVerifyOtpDto } from './dto';

const OTP_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * Patient portal API (spec §M14). Every route is marked @Public() so the
 * global JwtAuthGuard (staff tokens only) skips them; personal-cabinet routes
 * are protected by the local PortalAuthGuard (portal patient JWT).
 */
@ApiTags('portal')
@Public()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  // ------------------------------------------------------------------- auth

  @Post('auth/request-otp')
  @Throttle(OTP_THROTTLE)
  @HttpCode(200)
  requestOtp(@Body() dto: PortalRequestOtpDto): Promise<{ requested: true }> {
    return this.portal.requestOtp(dto);
  }

  @Post('auth/verify')
  @Throttle(OTP_THROTTLE)
  @HttpCode(200)
  verify(@Body() dto: PortalVerifyOtpDto): Promise<{ accessToken: string; phone: string }> {
    return this.portal.verifyOtp(dto);
  }

  // --------------------------------------------------------- public catalog

  @Get('clinics/:clinicId')
  getClinic(@Param('clinicId', ParseUUIDPipe) clinicId: string): Promise<PortalClinicDto> {
    return this.portal.getClinic(clinicId);
  }

  @Get('slots')
  slots(@Query() query: PortalSlotsQueryDto): Promise<FreeSlot[]> {
    return this.portal.getSlots(query);
  }

  // ---------------------------------------------------------------- booking

  @Post('book')
  @UseGuards(PortalAuthGuard)
  book(
    @PortalPhone() phone: string,
    @Body() dto: PortalBookDto,
  ): Promise<PortalBookingResultDto> {
    return this.portal.book(phone, dto);
  }

  // ---------------------------------------------------------------- cabinet

  @Get('me')
  @UseGuards(PortalAuthGuard)
  me(@PortalPhone() phone: string): Promise<PortalPatientCardDto[]> {
    return this.portal.me(phone);
  }

  @Get('me/appointments')
  @UseGuards(PortalAuthGuard)
  meAppointments(
    @PortalPhone() phone: string,
    @Query() query: PortalAppointmentsQueryDto,
  ): Promise<PaginatedResult<PortalAppointmentDto>> {
    return this.portal.meAppointments(phone, query);
  }

  @Post('appointments/:id/cancel')
  @UseGuards(PortalAuthGuard)
  @HttpCode(200)
  cancelAppointment(
    @PortalPhone() phone: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PortalCancelAppointmentDto,
  ): Promise<{ id: string; status: string }> {
    return this.portal.cancelAppointment(phone, id, dto);
  }

  @Get('me/visits')
  @UseGuards(PortalAuthGuard)
  meVisits(
    @PortalPhone() phone: string,
    @Query() query: PortalListQueryDto,
  ): Promise<PaginatedResult<PortalVisitDto>> {
    return this.portal.meVisits(phone, query);
  }

  @Get('me/visits/:id')
  @UseGuards(PortalAuthGuard)
  meVisitDetail(
    @PortalPhone() phone: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PortalVisitDetailDto> {
    return this.portal.meVisitDetail(phone, id);
  }

  @Get('me/lab-results')
  @UseGuards(PortalAuthGuard)
  meLabResults(
    @PortalPhone() phone: string,
    @Query() query: PortalListQueryDto,
  ): Promise<PaginatedResult<PortalLabOrderDto>> {
    return this.portal.meLabResults(phone, query);
  }

  @Get('me/invoices')
  @UseGuards(PortalAuthGuard)
  meInvoices(
    @PortalPhone() phone: string,
    @Query() query: PortalListQueryDto,
  ): Promise<PaginatedResult<PortalInvoiceDto>> {
    return this.portal.meInvoices(phone, query);
  }

  @Post('feedback')
  @UseGuards(PortalAuthGuard)
  submitFeedback(
    @PortalPhone() phone: string,
    @Body() dto: PortalFeedbackDto,
  ): Promise<{ id: string }> {
    return this.portal.submitFeedback(phone, dto);
  }
}
