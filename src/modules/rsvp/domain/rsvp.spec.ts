import { partyCounts, partyRespondedAt, planRsvp, rsvpState, type RsvpGuest } from './rsvp';

const NOW = new Date('2026-10-05T15:00:00Z');
const guest = (overrides: Partial<RsvpGuest> & { id: string }): RsvpGuest => ({
  name: 'Convidado',
  isPlusOne: false,
  rsvpStatus: 'pending',
  ageGroup: 'adult',
  dietaryRestriction: null,
  songSuggestion: null,
  songSuggestedAt: null,
  respondedAt: null,
  ...overrides,
});
const celia = guest({ id: 'celia', name: 'Célia Moreira' });
const luiz = guest({ id: 'luiz', name: 'Luiz Moreira' });
const slot = guest({ id: 'slot', name: null, isPlusOne: true, ageGroup: null });
const GROUP = [celia, luiz, slot];

const plan = (answers: Parameters<typeof planRsvp>[0]['answers'], extra = {}) =>
  planRsvp({
    guests: GROUP,
    answers,
    signedByGuestId: 'celia',
    songQuestionEnabled: true,
    now: NOW,
    ...extra,
  });

describe('RSVP: o estado do formulário (RN08; Prazo RN01)', () => {
  it('RN08 - aberto com o site publicado e o prazo no futuro ou hoje, no fuso do casamento', () => {
    const at = (iso: string, rsvpDeadline: string | null) =>
      rsvpState({
        status: 'published',
        rsvpDeadline,
        timezone: 'America/Sao_Paulo',
        now: new Date(iso),
      });
    expect(at('2026-10-15T12:00:00Z', null)).toBe('open');
    // 15/10 às 23h59 em São Paulo ainda vale; 16/10 à 00h01, não.
    expect(at('2026-10-16T02:59:00Z', '2026-10-15')).toBe('open');
    expect(at('2026-10-16T03:01:00Z', '2026-10-15')).toBe('deadline_passed');
  });

  it('RN08 - pós-evento e carência fecham', () => {
    for (const status of ['post_event', 'grace'])
      expect(rsvpState({ status, rsvpDeadline: null, timezone: null, now: NOW })).toBe(
        'post_event',
      );
  });
});

describe('RSVP: a gravação do grupo (RN04 a RN07; Música RN04)', () => {
  it('RN06 - todo convidado com nome responde; a vaga pode faltar', () => {
    const result = plan([{ id: 'celia', status: 'confirmed' }]);
    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'guests', code: 'ANSWER_MISSING', params: { guestId: 'luiz' } }],
    });
    expect(
      plan([
        { id: 'celia', status: 'confirmed' },
        { id: 'luiz', status: 'declined' },
      ]).ok,
    ).toBe(true);
  });

  it('RN04 - quem assina é um convidado com nome do grupo, nunca a vaga', () => {
    const answers = [
      { id: 'celia', status: 'confirmed' as const },
      { id: 'luiz', status: 'confirmed' as const },
    ];
    for (const signedByGuestId of ['slot', 'outro'])
      expect(plan(answers, { signedByGuestId })).toEqual({
        ok: false,
        issues: [{ path: 'signedByGuestId', code: 'SIGNER_INVALID', params: {} }],
      });
  });

  it('RN05 - a vaga: o nome passa pelo trim e não aceita caractere de controle', () => {
    const base = [
      { id: 'celia', status: 'confirmed' as const },
      { id: 'luiz', status: 'confirmed' as const },
    ];
    expect(plan([...base, { id: 'slot', status: 'confirmed', name: 'Rita\nSouza' }])).toMatchObject(
      {
        issues: [{ path: 'guests.2.name', code: 'CONTROL_CHARACTER' }],
      },
    );
    expect(
      plan([...base, { id: 'slot', status: 'confirmed', name: 'a'.repeat(81) }]),
    ).toMatchObject({
      issues: [{ path: 'guests.2.name', code: 'TOO_LONG', params: { max: 80 } }],
    });
    const ok = plan([...base, { id: 'slot', status: 'confirmed', name: '  Rita Souza ' }]);
    expect(ok.ok && ok.guests[2]).toMatchObject({ name: 'Rita Souza', rsvpStatus: 'confirmed' });
  });

  it('RN06 e Música RN04 - Não vou apaga a restrição e a música; a música só muda a hora quando o texto muda', () => {
    const answered = guest({
      ...celia,
      rsvpStatus: 'confirmed',
      dietaryRestriction: 'sem glúten',
      songSuggestion: 'Evidências',
      songSuggestedAt: new Date('2026-09-01T00:00:00Z'),
      respondedAt: new Date('2026-09-01T00:00:00Z'),
    });
    const same = planRsvp({
      guests: [answered, luiz],
      answers: [
        {
          id: 'celia',
          status: 'confirmed',
          songSuggestion: 'Evidências',
          dietaryRestriction: 'vegana',
        },
        { id: 'luiz', status: 'confirmed' },
      ],
      signedByGuestId: 'celia',
      songQuestionEnabled: true,
      now: NOW,
    });
    // Só a restrição: a hora da música e o "Respondido em" ficam.
    expect(same.ok && same.guests[0]).toMatchObject({
      dietaryRestriction: 'vegana',
      songSuggestedAt: answered.songSuggestedAt,
      respondedAt: answered.respondedAt,
    });
    const declined = planRsvp({
      guests: [answered, luiz],
      answers: [
        { id: 'celia', status: 'declined', songSuggestion: 'Outra', dietaryRestriction: 'x' },
        { id: 'luiz', status: 'confirmed' },
      ],
      signedByGuestId: 'luiz',
      songQuestionEnabled: true,
      now: NOW,
    });
    expect(declined.ok && declined.guests[0]).toMatchObject({
      rsvpStatus: 'declined',
      dietaryRestriction: null,
      songSuggestion: null,
      songSuggestedAt: null,
      respondedAt: NOW,
    });
  });

  it('Música RN04 - com a pergunta desligada, o campo é ignorado e a guardada fica', () => {
    const answered = guest({ ...celia, rsvpStatus: 'confirmed', songSuggestion: 'Evidências' });
    const result = planRsvp({
      guests: [answered, luiz],
      answers: [
        { id: 'celia', status: 'confirmed', songSuggestion: 'a'.repeat(200) },
        { id: 'luiz', status: 'confirmed' },
      ],
      signedByGuestId: 'celia',
      songQuestionEnabled: false,
      now: NOW,
    });
    expect(result.ok && result.guests[0].songSuggestion).toBe('Evidências');
  });

  it('RN07 - sem mudança, nenhuma atualização', () => {
    const answered = [
      guest({ ...celia, rsvpStatus: 'confirmed' }),
      guest({ ...luiz, rsvpStatus: 'declined' }),
    ];
    const result = planRsvp({
      guests: answered,
      answers: [
        { id: 'celia', status: 'confirmed' },
        { id: 'luiz', status: 'declined' },
      ],
      signedByGuestId: 'celia',
      songQuestionEnabled: true,
      now: NOW,
    });
    expect(result.ok && result.updates).toEqual([]);
  });
});

describe('RSVP: os números do grupo (RN07; Prazo RN06)', () => {
  it('os totais contam a vaga; o "Respondido em" do grupo é a resposta mais recente dos convidados com nome', () => {
    const guests = [
      guest({ ...celia, rsvpStatus: 'confirmed', respondedAt: new Date('2026-10-01T00:00:00Z') }),
      guest({ ...luiz, rsvpStatus: 'declined', respondedAt: new Date('2026-10-03T00:00:00Z') }),
      guest({
        ...slot,
        rsvpStatus: 'confirmed',
        name: 'Rita',
        respondedAt: new Date('2026-10-04T00:00:00Z'),
      }),
    ];
    expect(partyCounts({ guests })).toEqual({ confirmed: 2, declined: 1 });
    expect(partyRespondedAt({ guests, responded: true })).toEqual(new Date('2026-10-03T00:00:00Z'));
    expect(partyRespondedAt({ guests, responded: false })).toBeNull();
  });
});
