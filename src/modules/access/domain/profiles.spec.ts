import { homeFor, profilesOf } from './profiles';

describe('Perfis da conta (RN14 e RN15 de Login; decisão 177)', () => {
  it('casal com vínculo de dono; cerimonialista ou vendedor com o indicador ativo', () => {
    expect(
      profilesOf({ ownsActiveWedding: true, referrer: { kind: 'planner', status: 'active' } }),
    ).toEqual(['couple', 'planner']);
    expect(
      profilesOf({ ownsActiveWedding: false, referrer: { kind: 'seller', status: 'active' } }),
    ).toEqual(['seller']);
    expect(profilesOf({ ownsActiveWedding: false, referrer: null })).toEqual([]);
  });

  it.each(['inactive', 'blocked'] as const)('indicador %s não dá perfil', (status) => {
    expect(profilesOf({ ownsActiveWedding: false, referrer: { kind: 'planner', status } })).toEqual(
      [],
    );
  });

  it('o home de cada perfil (decisões 173 e 177)', () => {
    expect(homeFor({ profile: 'couple' })).toBe('/app');
    expect(homeFor({ profile: 'planner' })).toBe('/cerimonialista');
    expect(homeFor({ profile: 'seller' })).toBe('/vendedor');
  });
});
