import {
  ownAccountEmail,
  SAMPLE_ACCOUNTS,
  SAMPLE_INVITATIONS,
  SAMPLE_WEDDINGS,
  sampleLifecycle,
  slugOfCouple,
} from './sample-data';
import { assertSeedAllowed } from './seed-sample-data';

describe('Dados de exemplo do Kore (decisão 181)', () => {
  it.each(['local', 'test', 'homolog'])('roda com APP_ENV %s', (appEnv) => {
    expect(() => assertSeedAllowed({ appEnv })).not.toThrow();
  });

  it.each(['production', ''])('recusa APP_ENV "%s"', (appEnv) => {
    expect(() => assertSeedAllowed({ appEnv })).toThrow(/db:seed não roda/);
  });

  it('endereço e e-mail sem acento, a partir dos nomes', () => {
    expect(slugOfCouple({ a: 'Natália', b: 'Vinícius' })).toBe('natalia-e-vinicius');
    expect(ownAccountEmail({ name: 'João', slug: 'fernanda-e-joao' })).toBe(
      'joao.fernanda-e-joao@exemplo.kore.local',
    );
  });

  it('todo e-mail do seed é do domínio de exemplo, e os 12 casamentos da Juliana estão lá', () => {
    const emails = [
      ...SAMPLE_ACCOUNTS.map(({ email }) => email),
      ...SAMPLE_INVITATIONS.flatMap(({ email }) => (email ? [email] : [])),
    ];
    expect(emails.every((email) => email.endsWith('@exemplo.kore.local'))).toBe(true);
    expect(SAMPLE_WEDDINGS.filter(({ plannerCollaborates }) => plannerCollaborates)).toHaveLength(
      12,
    );
  });

  describe('as datas de vida dos casamentos de exemplo (sugestão do Crivo no DoD da F3)', () => {
    const now = new Date('2026-11-18T15:00:00Z');
    const today = '2026-11-18';

    it('publicado e pós-evento: no ar até 3 meses depois do casamento, nunca menos de 20 dias', () => {
      expect(
        sampleLifecycle({ status: 'published', eventDate: '2026-12-05', today, now }),
      ).toMatchObject({
        publishedAt: expect.any(Date),
        endDate: '2027-03-05',
        paidThrough: '2027-03-05',
        graceUntil: null,
        expiredAt: null,
      });
      expect(
        sampleLifecycle({ status: 'post_event', eventDate: '2026-07-12', today, now }),
      ).toMatchObject({
        endDate: '2026-12-08',
        paidThrough: '2026-12-08',
      });
    });

    it('carência há 3 dias e expirado há 20, como a rotina grava (graceUntil + 7; expiredAt + 1; purgeAt + 6 meses)', () => {
      expect(
        sampleLifecycle({ status: 'grace', eventDate: '2026-08-29', today, now }),
      ).toMatchObject({
        endDate: '2026-11-15',
        graceUntil: '2026-11-22',
        expiredAt: null,
      });
      expect(sampleLifecycle({ status: 'expired', eventDate: '2026-03-15', today, now })).toEqual({
        publishedAt: expect.any(Date),
        endDate: '2026-10-29',
        paidThrough: '2026-10-29',
        graceUntil: '2026-11-05',
        expiredAt: '2026-11-06',
        purgeAt: '2027-05-06',
      });
    });

    it('rascunho e aguardando o casal ficam sem datas', () => {
      for (const status of ['draft', 'awaiting_couple'] as const)
        expect(sampleLifecycle({ status, eventDate: '2027-03-20', today, now })).toEqual({
          publishedAt: null,
          endDate: null,
          paidThrough: null,
          graceUntil: null,
          expiredAt: null,
          purgeAt: null,
        });
    });
  });
});
