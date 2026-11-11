import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { validationError } from '../../../shared/http/validation-errors';

/** A planilha enviada: até 5 MB (Importação RN03; decisão 185(6); ADR-39). */
export const SPREADSHEET_MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SPREADSHEET_MAX_BYTES, files: 1, fields: 0 },
}).single('file');

/**
 * Recebe o campo file do multipart, em memória, com o multer (ADR-39). É um
 * guard, e não um interceptor, para o upload acontecer antes da transação da
 * requisição (o interceptor global): a conexão do banco não fica presa enquanto
 * o arquivo sobe. Acima de 5 MB: 413 FILE_TOO_LARGE, com o código no error.
 */
@Injectable()
export class SpreadsheetUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return new Promise((resolve, reject) => {
      upload(request, response, (error: unknown) => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          reject(
            new HttpException(
              {
                statusCode: 413,
                error: 'FILE_TOO_LARGE',
                message: 'The file is larger than 5 MB.',
                maxBytes: SPREADSHEET_MAX_BYTES,
              },
              HttpStatus.PAYLOAD_TOO_LARGE,
            ),
          );
          return;
        }
        if (error || !request.file) {
          reject(validationError({ errors: [{ path: 'file', code: 'IS_NOT_EMPTY', params: {} }] }));
          return;
        }
        resolve(true);
      });
    });
  }
}
