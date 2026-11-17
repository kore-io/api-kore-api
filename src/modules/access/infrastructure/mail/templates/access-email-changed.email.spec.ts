import { newAccessEmail, oldAccessEmail } from './access-email-changed.email';

const url = 'http://localhost:5173/entrar/confirmar?token=abc';

describe('E-mails da troca do e-mail de acesso (Backoffice - acesso RN09)', () => {
  it('RN09 - ao endereço novo: o assunto, o pré-cabeçalho, o botão Entrar no Kore com o link e o aviso dos 15 minutos', () => {
    const email = newAccessEmail({ to: 'ana.nova@gmail.com', accessUrl: url });

    expect(email.subject).toBe('Seu novo e-mail de acesso ao Kore');
    expect(email.to).toBe('ana.nova@gmail.com');
    expect(email.html).toContain('O botão vale por 15 minutos.');
    expect(email.text).toContain('Olá!');
    expect(email.text).toContain(
      'A pedido do casal, a equipe do Kore trocou o e-mail de acesso da sua conta para este endereço.',
    );
    expect(email.text).toContain(`Entrar no Kore: ${url}`);
    expect(email.html).toContain(`href="${url.replace('&', '&amp;')}"`);
    expect(email.text).toContain(
      'O botão vale por 15 minutos e só uma vez. Depois, entre com este e-mail para receber um código.',
    );
  });

  it('RN09 - sem o pedido de login (limite da RN04), o e-mail novo sai sem o botão', () => {
    const email = newAccessEmail({ to: 'ana.nova@gmail.com', accessUrl: null });
    expect(email.text).not.toContain('Entrar no Kore');
    expect(email.text).toContain('Depois, entre com este e-mail para receber um código.');
  });

  it('RN09 - ao endereço antigo: o novo só mascarado, e o contato do suporte', () => {
    const email = oldAccessEmail({ to: 'ana@gmail.com', newEmailMasked: 'ana***@gmail.com' });

    expect(email.subject).toBe('O e-mail de acesso da sua conta mudou');
    expect(email.text).toContain(
      'A pedido do casal, a equipe do Kore trocou o e-mail de acesso da sua conta para ana***@gmail.com. Este endereço não entra mais no Kore.',
    );
    expect(email.text).toContain('Se não foi você, escreva agora para suporte@kore.com.br.');
    expect(`${email.text}${email.html}`).not.toContain('ana.nova');
  });
});
