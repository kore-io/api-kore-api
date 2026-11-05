import { loginCodeEmail } from './login-code.email';

describe('E-mail do código de login (Voz & Microcopy, e-mail 1)', () => {
  const email = loginCodeEmail({
    to: 'ana@kore.local',
    code: '482913',
    accessUrl: 'https://app.kore.com.br/entrar/confirmar?token=abc',
  });

  it('dado um código, quando monta o e-mail, então usa o assunto da Voz e o código com espaço no meio', () => {
    expect(email.subject).toBe('Seu código para entrar no Kore');
    expect(email.text).toContain('482 913');
    expect(email.html).toContain('482 913');
    expect(email.html).toContain('https://app.kore.com.br/entrar/confirmar?token=abc');
  });

  it('dado o código e o link, quando monta o e-mail, então nenhum dos dois vai no assunto nem no pré-cabeçalho', () => {
    const preheader = /<span style="display:none[^>]*>([^<]*)<\/span>/.exec(email.html ?? '')?.[1];

    expect(preheader).toBe('Ele vale por 15 minutos.');
    expect(`${email.subject} ${preheader}`).not.toMatch(/482|token/);
  });

  it('RN03 - dado qualquer pessoa, quando monta o e-mail, então a saudação não tem nome', () => {
    expect(email.text.startsWith('Olá!')).toBe(true);
  });
});
