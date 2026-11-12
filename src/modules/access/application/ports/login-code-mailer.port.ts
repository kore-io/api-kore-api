/** Envia o e-mail com o código e o botão de acesso (RN01 de Login). */
export interface LoginCodeMailer {
  send({ email, code, token }: { email: string; code: string; token: string }): Promise<void>;
}

export const LOGIN_CODE_MAILER = Symbol('LoginCodeMailer');
