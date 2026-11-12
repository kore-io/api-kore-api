import {
  ownAccountEmail,
  SAMPLE_ACCOUNTS,
  SAMPLE_INVITATIONS,
  SAMPLE_WEDDINGS,
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
});
