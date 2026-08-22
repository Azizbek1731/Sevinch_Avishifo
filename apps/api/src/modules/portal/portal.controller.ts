import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import type { PaginatedResult } from '../../common/pagination';
import type { FreeSlot } from '../appointments/slots.service';
import { PortalAuthGuard, PortalPhone } from './portal-auth.guard';
import { PortalService } from './portal.service';
import { RecordAccessService } from '../record-access/record-access.service';
import { RequestRecordAccessDto } from '../record-access/dto';
import {
  type PortalAppointmentDto,
  type PortalBookingResultDto,
  type PortalClinicDto,
  type PortalDocumentDto,
  type PortalInvoiceDto,
  type PortalLabOrderDto,
  type PortalPatientCardDto,
  type PortalProfileDto,
  type PortalTelegramStatusDto,
  type PortalVisitDto,
  type PortalVisitDetailDto,
} from './portal.service';
import { PortalAppointmentsQueryDto, PortalBookDto, PortalCancelAppointmentDto, PortalFeedbackDto, PortalListQueryDto, PortalRequestOtpDto, PortalSlotsQueryDto, PortalUpdateProfileDto, PortalVerifyOtpDto } from './dto';

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
  constructor(
    private readonly portal: PortalService,
    private readonly recordAccessService: RecordAccessService,
  ) {}

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
  verify(
    @Body() dto: PortalVerifyOtpDto,
  ): Promise<{ accessToken: string; phone: string; isNew: boolean }> {
    return this.portal.verifyOtp(dto);
  }

  // --------------------------------------------------------- public catalog

  /** Runtime hints (Telegram bot username / enabled) for the portal UI. */
  @Get('config')
  config(): { telegramBotUsername: string | null; telegramEnabled: boolean } {
    return this.portal.getPublicConfig();
  }

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

  // ---------------------------------------------------------------- profile

  @Get('me/profile')
  @UseGuards(PortalAuthGuard)
  profile(@PortalPhone() phone: string): Promise<PortalProfileDto> {
    return this.portal.getProfile(phone);
  }

  @Post('me/profile')
  @UseGuards(PortalAuthGuard)
  @HttpCode(200)
  updateProfile(
    @PortalPhone() phone: string,
    @Body() dto: PortalUpdateProfileDto,
  ): Promise<PortalProfileDto> {
    return this.portal.updateProfile(phone, dto);
  }

  // -------------------------------------------------------------- documents

  @Get('me/documents')
  @UseGuards(PortalAuthGuard)
  meDocuments(
    @PortalPhone() phone: string,
    @Query() query: PortalListQueryDto,
  ): Promise<PaginatedResult<PortalDocumentDto>> {
    return this.portal.getDocuments(phone, query);
  }

  @Get('me/documents/:id/download')
  @UseGuards(PortalAuthGuard)
  async downloadDocument(
    @PortalPhone() phone: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { stream, mimeType, fileName } = await this.portal.downloadDocument(phone, id);
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }

  /** The approved lab result as a downloadable PDF. */
  @Get('me/lab-results/:id/download')
  @UseGuards(PortalAuthGuard)
  async downloadLabResult(
    @PortalPhone() phone: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.portal.labResultPdf(phone, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }

  // ---------------------------------------------------- medical-record access

  /**
   * One row per clinic the patient has records in, with its access state. Lab
   * results are never gated by this — only the clinical narrative is.
   */
  @Get('me/record-access')
  @UseGuards(PortalAuthGuard)
  recordAccess(@PortalPhone() phone: string): Promise<unknown[]> {
    return this.recordAccessService.patientOverview(phone);
  }

  @Post('me/record-access/:clinicId')
  @UseGuards(PortalAuthGuard)
  @HttpCode(200)
  requestRecordAccess(
    @PortalPhone() phone: string,
    @Param('clinicId', ParseUUIDPipe) clinicId: string,
    @Body() dto: RequestRecordAccessDto,
  ): Promise<{ status: string }> {
    return this.recordAccessService.request(phone, clinicId, dto.note);
  }

  // --------------------------------------------------------------- telegram

  @Get('me/telegram')
  @UseGuards(PortalAuthGuard)
  telegramStatus(@PortalPhone() phone: string): Promise<PortalTelegramStatusDto> {
    return this.portal.getTelegramStatus(phone);
  }

  @Post('me/telegram/link')
  @UseGuards(PortalAuthGuard)
  @HttpCode(200)
  telegramLink(
    @PortalPhone() phone: string,
  ): Promise<{ token: string; deepLink: string | null; botUsername: string | null; enabled: boolean }> {
    return this.portal.createTelegramLinkToken(phone);
  }

  @Post('me/telegram/unlink')
  @UseGuards(PortalAuthGuard)
  @HttpCode(200)
  telegramUnlink(@PortalPhone() phone: string): Promise<{ linked: false }> {
    return this.portal.unlinkTelegram(phone);
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
