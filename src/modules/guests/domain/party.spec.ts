import { defaultContactIndex } from './party';

describe('Convidado de contato (Grupos RN06)', () => {
  it('RN06 - o primeiro com telefone ou e-mail é o padrão', () => {
    expect(
      defaultContactIndex({
        guests: [{ phone: null, email: null }, { phone: '+5519998761402' }, { email: 'a@b.c' }],
      }),
    ).toBe(1);
  });

  it('RN06 - sem telefone nem e-mail, o grupo fica sem contato', () => {
    expect(defaultContactIndex({ guests: [{}, { phone: null, email: null }] })).toBeNull();
  });
});
