import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticateSession } from './application/authenticate-session.use-case';
import { EndAllSessions } from './application/end-all-sessions.use-case';
import { EndSession } from './application/end-session.use-case';
import { GetMe } from './application/get-me.use-case';
import { SESSION_REPOSITORY } from './application/ports/session-repository.port';
import { SESSION_TOKENS } from './application/ports/session-token.port';
import { USER_REPOSITORY } from './application/ports/user-repository.port';
import { StartSession } from './application/start-session.use-case';
import { OpaqueSessionTokens } from './infrastructure/opaque-session-tokens';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { AuthController } from './presentation/auth.controller';
import { MeController } from './presentation/me.controller';
import { SessionGuard } from './presentation/session.guard';

/** Contexto Acesso: sessão, login, papéis e convites de acesso. */
@Module({
  controllers: [AuthController, MeController],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_TOKENS, useClass: OpaqueSessionTokens },
    { provide: APP_GUARD, useClass: SessionGuard },
    AuthenticateSession,
    StartSession,
    EndSession,
    EndAllSessions,
    GetMe,
  ],
  exports: [StartSession],
})
export class AccessModule {}
