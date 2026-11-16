import {
  plannerDigestEmail,
  plannerImmediateEmail,
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

describe('Os e-mails da cerimonialista (Notificações da cerimonialista RN07; Pena)', () => {
  const totals = { confirmed: 96, declined: 18, pending: 28 };

  it('Na hora: a contagem e o casal, sem nome de grupo nem de convidado', () => {
    const email = plannerImmediateEmail({
      context: {
        to: 'juliana@prado.com',
        firstName: 'Juliana',
        partnerNames: ['Ana', 'Marcos'],
        groupCount: 3,
        totals,
        weddingUrl: 'http://app/cerimonialista/casamentos/w1',
        settingsUrl: 'http://app/cerimonialista/configuracoes/notificacoes',
      },
    });

    expect(email.subject).toBe('3 grupos responderam em Ana e Marcos');
    expect(email.text).toContain('Olá, Juliana.');
    expect(email.text).toContain('Hoje, 3 grupos responderam o convite de Ana e Marcos.');
    expect(email.text).toContain(
      'No total, o casamento tem 96 confirmados, 18 recusados e 28 pendentes.',
    );
    expect(email.text).toContain('Abrir o casamento: http://app/cerimonialista/casamentos/w1');
    expect(
      plannerImmediateEmail({
        context: {
          to: 'j@x.com',
          firstName: null,
          partnerNames: ['Ana', 'Marcos'],
          groupCount: 1,
          totals,
          weddingUrl: 'u',
          settingsUrl: 's',
        },
      }).subject,
    ).toBe('1 grupo respondeu em Ana e Marcos');
  });

  it('Resumo agrupado: um bloco por casamento, com as respostas e o "Site publicado"', () => {
    const email = plannerDigestEmail({
      to: 'juliana@prado.com',
      firstName: 'Juliana',
      blocks: [
        { partnerNames: ['Ana', 'Marcos'], groupCount: 3, published: false },
        { partnerNames: ['Fernanda', 'João'], groupCount: 1, published: true },
      ],
      homeUrl: 'http://app/cerimonialista',
      settingsUrl: 'http://app/cerimonialista/configuracoes/notificacoes',
    });

    expect(email.subject).toBe('Resumo do dia: novidades em 2 casamentos');
    expect(email.text).toContain(
      ['Hoje, nos seus casamentos:', 'Ana e Marcos', '3 grupos responderam'].join('\n\n'),
    );
    expect(email.text).toContain(
      ['Fernanda e João', '1 grupo respondeu', 'Site publicado'].join('\n\n'),
    );
    expect(email.text).toContain('Abrir Meus casamentos: http://app/cerimonialista');
    expect(email.text).toContain('Você recebe este resumo porque escolheu o resumo diário.');
    expect(
      plannerDigestEmail({
        to: 'j@x.com',
        firstName: null,
        blocks: [{ partnerNames: ['Ana', 'Marcos'], groupCount: 0, published: true }],
        homeUrl: 'h',
        settingsUrl: 's',
      }).subject,
    ).toBe('Resumo do dia: novidades em 1 casamento');
  });
});
