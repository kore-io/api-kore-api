import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticateSession } from './application/authenticate-session.use-case';
import { SESSION_REPOSITORY } from './application/ports/session-repository.port';
import { SESSION_TOKENS } from './application/ports/session-token.port';
import { StartSession } from './application/start-session.use-case';
import { OpaqueSessionTokens } from './infrastructure/opaque-session-tokens';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { SessionGuard } from './presentation/session.guard';

/** Contexto Acesso: sessão, login, papéis e convites de acesso. */
@Module({
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: SESSION_TOKENS, useClass: OpaqueSessionTokens },
    { provide: APP_GUARD, useClass: SessionGuard },
    AuthenticateSession,
    StartSession,
  ],
  exports: [StartSession],
})
export class AccessModule {}
