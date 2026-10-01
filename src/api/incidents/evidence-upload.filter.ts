import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class EvidenceUploadExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const message =
      error.code === 'LIMIT_FILE_SIZE' ? 'Attachment exceeds the 15 MB limit' : error.message;
    response.status(400).json({
      statusCode: 400,
      message,
      error: 'Bad Request',
    });
  }
}
