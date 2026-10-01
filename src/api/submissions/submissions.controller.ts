import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../guards/admin.guard';
import { CreateMissingPersonReportDto } from './dto/create-missing-person-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { SubmissionsService } from './submissions.service';

@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a family missing-person report',
    description:
      'Saves the report as PENDING_REVIEW. The reporter name and contact are encrypted and omitted from this response.',
  })
  create(@Body() dto: CreateMissingPersonReportDto) {
    return this.submissionsService.create(dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiHeader({ name: 'x-api-key', required: false, description: 'Admin API key' })
  @ApiOperation({
    summary: 'List family reports',
    description: 'Requires an admin API key in x-api-key or Authorization. Decrypts reporter contact details.',
  })
  list() {
    return this.submissionsService.listForAdmin();
  }

  @Get(':id/suggestions')
  @UseGuards(AdminGuard)
  @ApiHeader({ name: 'x-api-key', required: false, description: 'Admin API key' })
  @ApiOperation({
    summary: 'Suggest documented incidents for a family report',
    description: 'Ranks incidents by date proximity and departure location. Requires an admin API key.',
  })
  suggestions(@Param('id', ParseUUIDPipe) id: string) {
    return this.submissionsService.suggestions(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiHeader({ name: 'x-api-key', required: false, description: 'Admin API key' })
  @ApiOperation({
    summary: 'Update a family report status',
    description: 'Sets the review status. Requires an admin API key.',
  })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReportStatusDto) {
    return this.submissionsService.updateStatus(id, dto.status);
  }
}
