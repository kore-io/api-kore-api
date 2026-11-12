import {
  digestEmail,
  groupLine,
  immediateEmail,
  localHour,
  pendingGroups,
  totalsLine,
  type EmailContext,
} from './notification-email';

const moreira = {
  partyId: 'p1',
  name: 'Família Moreira',
  confirmed: 3,
  declined: 0,
  at: '2026-09-12T22:40:00.000Z',
};
const duarte = {
  partyId: 'p2',
  name: 'Família Duarte',
  confirmed: 2,
  declined: 1,
  at: '2026-09-12T22:50:00.000Z',
};
const context = (groups: EmailContext['groups']): EmailContext => ({
  to: 'ana@kore.local',
  firstName: 'Ana',
  groups,
  totals: { confirmed: 96, declined: 18, pending: 28 },
  guestsUrl: 'http://localhost:5173/app/convidados',
  settingsUrl: 'http://localhost:5173/app/configuracoes/notificacoes',
});

describe('E-mail das respostas (E-mail e push RN02 a RN06)', () => {
  it('RN02 - só os grupos depois do cursor; o mesmo grupo uma vez, com a resposta mais nova', () => {
    const older = { ...moreira, confirmed: 1, at: '2026-09-12T20:00:00.000Z' };
    expect(
      pendingGroups({
        payloads: [[older, duarte], [moreira]],
        emailedThrough: new Date('2026-09-12T21:00:00.000Z'),
      }),
    ).toEqual([moreira, duarte]);
    expect(pendingGroups({ payloads: [[moreira]], emailedThrough: new Date(moreira.at) })).toEqual(
      [],
    );
  });

  it('RN03 - as linhas: a parte com zero sai, com o singular', () => {
    expect(groupLine({ group: moreira })).toBe('Família Moreira: 3 confirmados');
    expect(groupLine({ group: duarte })).toBe('Família Duarte: 2 confirmados, 1 recusado');
    expect(totalsLine({ confirmed: 96, declined: 18, pending: 28 })).toBe(
      'No total, o casamento tem 96 confirmados, 18 recusados e 28 pendentes.',
    );
    expect(totalsLine({ confirmed: 1, declined: 0, pending: 1 })).toBe(
      'No total, o casamento tem 1 confirmado e 1 pendente.',
    );
  });

  it('RN03 - o "Na hora": o assunto pelo número de grupos, o pré-cabeçalho sem nome, o botão e o rodapé', () => {
    const one = immediateEmail({ context: context([moreira]) });
    expect(one.subject).toBe('Família Moreira respondeu o convite');
    const many = immediateEmail({ context: context([moreira, duarte]) });
    expect(many.subject).toBe('2 grupos responderam o convite');
    expect(many.text).toContain('Olá, Ana.');
    expect(many.text).toContain('Chegaram respostas ao convite do casamento de vocês:');
    expect(many.text).toContain('Família Duarte: 2 confirmados, 1 recusado');
    expect(many.text).toContain('Ver a lista de convidados: http://localhost:5173/app/convidados');
    expect(many.text).toContain('escolheu receber as respostas na hora');
    expect(many.html).toContain('Confira as respostas no Kore.');
  });

  it('RN04 - o Resumo diário, com o singular', () => {
    expect(digestEmail({ context: context([moreira]) }).subject).toBe(
      'Resumo do dia: 1 grupo respondeu',
    );
    const many = digestEmail({ context: context([moreira, duarte]) });
    expect(many.subject).toBe('Resumo do dia: 2 grupos responderam');
    expect(many.text).toContain('Hoje, 2 grupos responderam o convite:');
    expect(many.text).toContain('escolheu o resumo diário');
  });

  it('RN06 - o nome do grupo é escapado no HTML e perde as quebras de linha no assunto', () => {
    const odd = { ...moreira, name: 'Tio <b>Zé</b>\r\nBcc: x@y.z' };
    const email = immediateEmail({ context: context([odd]) });
    expect(email.subject).toBe('Tio <b>Zé</b> Bcc: x@y.z respondeu o convite');
    expect(email.html).toContain('Tio &lt;b&gt;Zé&lt;/b&gt;');
    expect(email.html).not.toContain('<b>Zé</b>');
  });

  it('RN04 - a hora local no fuso do casamento', () => {
    expect(localHour({ at: new Date('2026-09-12T23:00:00Z'), timezone: 'America/Sao_Paulo' })).toBe(
      20,
    );
  });
});
