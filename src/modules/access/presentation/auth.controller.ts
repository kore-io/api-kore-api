import { Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { EndAllSessions } from '../application/end-all-sessions.use-case';
import { EndSession } from '../application/end-session.use-case';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import { CurrentSession } from './current-session.decorator';
import { clearSessionCookie } from './session-cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly endSession: EndSession,
    private readonly endAllSessions: EndAllSessions,
  ) {}

  /** Sair: encerra a sessão deste aparelho (RN09). */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.endSession.execute({ sessionId: session.sessionId, now: new Date() });
    clearSessionCookie({ response });
  }

  /** Sair de todos os aparelhos, inclusive este (RN09). */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentSession() session: AuthenticatedSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.endAllSessions.execute({ userId: session.userId, now: new Date() });
    clearSessionCookie({ response });
  }
}
