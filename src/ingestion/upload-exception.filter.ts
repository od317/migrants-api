import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class DatasetUploadExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    writeUploadError(error, host, 'Upload exceeds the 50 MB limit');
  }
}

@Catch(MulterError)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    writeUploadError(error, host, 'Upload exceeds the 25 MB limit');
  }
}

function writeUploadError(error: MulterError, host: ArgumentsHost, sizeMessage: string): void {
  const response = host.switchToHttp().getResponse<Response>();
  const message = error.code === 'LIMIT_FILE_SIZE' ? sizeMessage : error.message;
  response.status(400).json({
    statusCode: 400,
    message,
    error: 'Bad Request',
  });
}
