import type { Request } from 'express';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedSession;
}
