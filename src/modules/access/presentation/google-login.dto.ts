import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { LoginOrigin } from '../domain/login-next-step';

const LOGIN_ORIGINS: LoginOrigin[] = [
  'invite',
  'referral',
  'couple_signup',
  'planner_signup',
  'none',
];

export class StartGoogleLoginQuery {
  /** De onde a pessoa veio (RN06); padrão none. */
  @IsOptional()
  @IsIn(LOGIN_ORIGINS)
  origin?: LoginOrigin;

  /**
   * Código de indicação ou token do convite. Não é guardado (decisão 142): a
   * origem basta para o próximo passo, e o app guarda o resto.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  originRef?: string;

  /** Página de volta (RN10); só caminho relativo do app (decisão 136). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  next?: string;
}

export class DevGoogleQuery {
  @IsString()
  @MaxLength(200)
  state: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  /** Simula um e-mail não verificado no Google (casos de borda do Login). */
  @IsOptional()
  @IsIn(['true', 'false'])
  verified?: 'true' | 'false';
}
