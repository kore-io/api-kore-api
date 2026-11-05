import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { LoginOrigin } from '../domain/login-next-step';

const LOGIN_ORIGINS: LoginOrigin[] = [
  'invite',
  'referral',
  'couple_signup',
  'planner_signup',
  'none',
];

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RequestLoginChallengeBody {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** De onde a pessoa veio (RN06); padrão none. */
  @IsOptional()
  @IsIn(LOGIN_ORIGINS)
  origin?: LoginOrigin;

  /**
   * Código de indicação. Com origin invite, o token do convite é descartado: o
   * app o guarda e volta ao convite depois do login (decisão 142).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  originRef?: string;
}

export class RequestLoginChallengeResponse {
  email: string;
  resendAvailableAt: string;
}

/** Pelo código: email + code. Pelo botão do e-mail: só token. */
export class VerifyLoginChallengeBody {
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(20, 200)
  token?: string;
}

class VerifiedUser {
  id: string;
  email: string;
  isNew: boolean;
}

export class VerifyLoginChallengeResponse {
  user: VerifiedUser;
  next: 'home' | 'choose_profile' | 'couple_signup' | 'planner_signup' | 'invite';
}
