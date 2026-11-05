import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetMe } from '../application/get-me.use-case';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import { toHttpError } from './access-http-errors';
import { CurrentSession } from './current-session.decorator';
import { MeResponse } from './me.dto';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly getMe: GetMe) {}

  /** Quem está conectado; a leitura também renova a sessão (RN08). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }))
  async me(@CurrentSession() session: AuthenticatedSession): Promise<MeResponse> {
    try {
      return MeResponse.from({ me: await this.getMe.execute({ session }) });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
