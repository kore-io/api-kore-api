import { maskPhone, parsePhone } from './phone';

describe('parsePhone (Grupos RN04; decisão 189, item 4)', () => {
  it.each([
    ['(19) 99876-1402', '+5519998761402'],
    ['19 3234-5678', '+551932345678'],
    ['019998761402', '+5519998761402'],
    ['5519998761402', '+5519998761402'],
    ['551932345678', '+551932345678'],
    ['05519998761402', '+5519998761402'],
    ['+55 19 99876-1402', '+5519998761402'],
    ['+351 912 345 678', '+351912345678'],
    ['+1 (202) 555-0123', '+12025550123'],
  ])('RN04 - "%s" vira %s', (raw, e164) => {
    expect(parsePhone({ raw })).toEqual({ ok: true, e164 });
  });

  it('RN04 - aceita a célula número da planilha (Importação RN05)', () => {
    expect(parsePhone({ raw: 19998761402 })).toEqual({ ok: true, e164: '+5519998761402' });
  });

  it('RN04 - com menos de 10 dígitos e sem "+", PHONE_TOO_SHORT com o n dos dígitos como vieram', () => {
    expect(parsePhone({ raw: '9876-1402' })).toEqual({
      ok: false,
      code: 'PHONE_TOO_SHORT',
      params: { n: 8 },
    });
    // O zero de tronco sai antes da conta, mas o n conta como veio.
    expect(parsePhone({ raw: '019876140' })).toEqual({
      ok: false,
      code: 'PHONE_TOO_SHORT',
      params: { n: 9 },
    });
  });

  it('RN04 - com mais de 11 dígitos e sem "+" (que não seja 55 + 10 ou 11), PHONE_TOO_LONG', () => {
    expect(parsePhone({ raw: '351912345678' })).toEqual({
      ok: false,
      code: 'PHONE_TOO_LONG',
      params: { n: 12 },
    });
  });

  it.each([
    ['+1234567', 7],
    ['+1234567890123456', 16],
    ['+999 1234 5678', 11],
  ])('RN04 - "%s" é PHONE_INVALID (fora de 8 a 15 dígitos ou país que não existe)', (raw, n) => {
    expect(parsePhone({ raw })).toEqual({ ok: false, code: 'PHONE_INVALID', params: { n } });
  });
});

describe('maskPhone (Grupos RN13; decisão 186, item 11)', () => {
  it.each([
    ['+5519998763310', '(19) 9****-3310'],
    ['+551932343310', '(19) 3***-3310'],
    ['+5511998768024', '(11) 9****-8024'],
    ['+351912345678', '+351 9** *** 678'],
    ['+12025550123', '+1 2 *** *** 123'],
  ])('RN13 - %s vira %s', (e164, masked) => {
    expect(maskPhone({ e164 })).toBe(masked);
  });
});
