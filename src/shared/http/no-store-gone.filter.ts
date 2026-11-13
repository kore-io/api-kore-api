import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/** As respostas do site fora do ar (Data de saída do ar RN08; Casamento bloqueado RN05). */
const NO_STORE_STATUSES = new Set([410, 423]);

/**
 * `410 SITE_EXPIRED` e `423 SITE_UNAVAILABLE` levam `Cache-Control: no-store`
 * (RN08): a renovação, o desbloqueio e o cancelamento da exclusão voltam na
 * hora, sem uma cópia guardada no caminho. O resto segue o tratamento padrão.
 */
@Catch(HttpException)
export class NoStoreGoneFilter extends BaseExceptionFilter {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    if (NO_STORE_STATUSES.has(exception.getStatus()) && host.getType() === 'http')
      host.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    super.catch(exception, host);
  }
}
