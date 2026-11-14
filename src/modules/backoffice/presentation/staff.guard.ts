import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfigService } from '../../../shared/config/app-config.service';
import type { AuthenticatedRequest } from '../../access/presentation/authenticated-request';
import { STAFF_DIRECTORY, type StaffDirectory } from '../application/ports/staff-directory.port';
import { isStaffSession, type StaffMember, type StaffRole } from '../domain/staff';

export interface StaffRequest extends AuthenticatedRequest {
  staff?: StaffMember;
}

const STAFF_ROLES = 'staffRoles';

/** Só estes papéis (RN02); sem o decorator, o Admin e o suporte. */
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES, roles);

/** O staff da requisição, já conferido pelo StaffGuard. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffMember => {
    const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
    if (!staff) throw new Error('Rota do Backoffice sem o StaffGuard.');
    return staff;
  },
);

/**
 * O guard das rotas /v1/admin (Backoffice - acesso RN01 e RN02), depois do
 * SessionGuard global: o login pelo Google com o `hd` do GOOGLE_STAFF_DOMAIN e
 * o papel `admin` ou `support` lido do banco nesta requisição. Fora disso,
 * `403 STAFF_ONLY`, sem dizer o motivo. Fora do papel da rota, `403 ACTION_NOT_ALLOWED`.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
    @Inject(STAFF_DIRECTORY) private readonly directory: StaffDirectory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const auth = request.auth;
    if (
      !auth ||
      !isStaffSession({
        authMethod: auth.authMethod,
        staffDomain: auth.staffDomain,
        expectedDomain: this.config.staffDomain,
      })
    )
      throw staffOnly();
    const role = await this.directory.roleOf({ userId: auth.userId });
    if (!role) throw staffOnly();
    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(role))
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ACTION_NOT_ALLOWED',
        message: 'This action is not allowed for your role.',
      });
    request.staff = { userId: auth.userId, role };
    return true;
  }
}

function staffOnly(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'STAFF_ONLY',
    message: 'Only the Kore team can access this area.',
  });
}
