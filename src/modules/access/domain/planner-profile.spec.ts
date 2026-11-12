import { nextReferralCode, referralCodeBase } from './invitation-acceptance';
import {
  checkPlannerProfile,
  creditNameForSite,
  isProfileComplete,
  isValidCreditName,
} from './planner-profile';

describe('Dados profissionais do cerimonialista (Cadastro e perfil RN04, RN05 e RN10)', () => {
  it.each([
    'Prado Assessoria www.prado.com.br',
    'Prado prado.com.br',
    'Prado 11 9 9999-9999',
    'Prado juliana@prado.com',
    'Prado http://x',
    'Prado <b>',
    'Prado eventos.net',
    'Prado​Assessoria',
    'Prado ‮airosses',
    'Prado\nAssessoria',
    'P',
    'P'.repeat(81),
  ])('RN04 - CREDIT_NAME_INVALID: %j', (name) => {
    expect(isValidCreditName({ value: name })).toBe(false);
  });

  it.each([
    'Prado & Filhos (Eventos), Ltda.',
    "D'Ávila Cerimonial",
    'Juliana Prado',
    'Ateliê 7 - Eventos',
    'Cerimonial J.R. S.A.',
  ])('RN04 - nome aceito: %j', (name) => {
    expect(isValidCreditName({ value: name })).toBe(true);
  });

  it('RN04 - NFKC: o ponto de largura total vira ponto e o domínio é pego', () => {
    expect(isValidCreditName({ value: 'Prado prado．com' })).toBe(false);
  });

  it('RN04 - no cadastro, o nome da assessoria, as cidades e o nome (sem nome na conta) são obrigatórios', () => {
    const { issues } = checkPlannerProfile({
      input: {},
      required: ['creditName', 'name', 'cities'],
    });

    expect(issues).toEqual([
      { path: 'creditName', code: 'REQUIRED', params: {} },
      { path: 'name', code: 'REQUIRED', params: {} },
      { path: 'cities', code: 'REQUIRED', params: {} },
    ]);
  });

  it('RN04 - normaliza: NFKC e espaços no nome, só os dígitos do telefone, "O mesmo do telefone"', () => {
    const { changes, issues } = checkPlannerProfile({
      input: {
        creditName: '  Prado   Assessoria ',
        phone: '(11) 3333-4444',
        whatsapp: '(11) 99999-8888',
        cities: [' Campinas (SP) ', 'Valinhos (SP)'],
      },
      required: ['creditName', 'cities'],
    });

    expect(issues).toEqual([]);
    expect(changes).toEqual({
      creditName: 'Prado Assessoria',
      phone: '1133334444',
      whatsapp: '11999998888',
      cities: ['Campinas (SP)', 'Valinhos (SP)'],
    });
  });

  it('RN04 - telefone com DDD e 10 ou 11 dígitos; vazio ou nulo apaga', () => {
    const check = (phone: string | null) => checkPlannerProfile({ input: { phone }, required: [] });

    expect(check('9999-8888').issues).toEqual([
      { path: 'phone', code: 'PHONE_INVALID', params: {} },
    ]);
    expect(check('(01) 99999-8888').issues).toHaveLength(1);
    expect(check('119999988887').issues).toHaveLength(1);
    expect(check('').changes).toEqual({ phone: null });
    expect(check(null).changes).toEqual({ phone: null });
  });

  it('RN04 - cidades: "Cidade (UF)" com a UF entre as 27, sem repetir, até 80 e até 50', () => {
    const issuesOf = (cities: string[]) =>
      checkPlannerProfile({ input: { cities }, required: [] }).issues;

    expect(issuesOf([])).toEqual([{ path: 'cities', code: 'REQUIRED', params: {} }]);
    expect(issuesOf(['Campinas', 'Campinas (XX)', 'campinas (sp)'])).toEqual([
      { path: 'cities.0', code: 'INVALID', params: {} },
      { path: 'cities.1', code: 'INVALID', params: {} },
      { path: 'cities.2', code: 'INVALID', params: {} },
    ]);
    expect(issuesOf(['Campinas (SP)', 'campinas (SP)'])).toEqual([
      { path: 'cities.1', code: 'DUPLICATE', params: {} },
    ]);
    expect(issuesOf([`${'a'.repeat(76)} (SP)`])).toEqual([
      { path: 'cities.0', code: 'TOO_LONG', params: { max: 80 } },
    ]);
    expect(issuesOf(Array.from({ length: 51 }, (_, index) => `Cidade ${index} (SP)`))).toEqual([
      { path: 'cities', code: 'TOO_MANY', params: { max: 50 } },
    ]);
  });

  it('RN04 - nome da assessoria: TOO_LONG, TOO_SHORT e CREDIT_NAME_INVALID; nome da pessoa até 80', () => {
    const issuesOf = (input: { creditName?: string; name?: string }) =>
      checkPlannerProfile({ input, required: [] }).issues;

    expect(issuesOf({ creditName: 'P'.repeat(81) })).toEqual([
      { path: 'creditName', code: 'TOO_LONG', params: { max: 80 } },
    ]);
    expect(issuesOf({ creditName: 'P' })).toEqual([
      { path: 'creditName', code: 'TOO_SHORT', params: { min: 2 } },
    ]);
    expect(issuesOf({ creditName: 'Prado www.prado.com' })).toEqual([
      { path: 'creditName', code: 'CREDIT_NAME_INVALID', params: {} },
    ]);
    expect(issuesOf({ name: 'J'.repeat(81) })).toEqual([
      { path: 'name', code: 'TOO_LONG', params: { max: 80 } },
    ]);
  });

  it('RN10 - completo com cidade, Termos vigentes e o nome que passa no predicado', () => {
    const complete = { creditName: 'Prado', cities: ['Campinas (SP)'], termsAccepted: true };

    expect(isProfileComplete(complete)).toBe(true);
    expect(isProfileComplete({ ...complete, cities: [] })).toBe(false);
    expect(isProfileComplete({ ...complete, termsAccepted: false })).toBe(false);
    expect(isProfileComplete({ ...complete, creditName: 'Clara www.clara.com' })).toBe(false);
  });

  it('RN05 - código reservado vale como repetido: "Suporte" vira suporte-2', () => {
    expect(nextReferralCode({ base: referralCodeBase({ name: 'Suporte' }), taken: [] })).toBe(
      'suporte-2',
    );
    expect(nextReferralCode({ base: 'kore', taken: ['kore-2'] })).toBe('kore-3');
    expect(nextReferralCode({ base: 'juliana-prado', taken: [] })).toBe('juliana-prado');
  });

  it('Assinatura RN03 - o nome do site: normalizado quando passa no predicado, nulo quando não', () => {
    expect(creditNameForSite({ raw: '  Prado   Assessoria ' })).toBe('Prado Assessoria');
    expect(creditNameForSite({ raw: 'Juliana 11 9 9999-9999' })).toBeNull();
    expect(creditNameForSite({ raw: null })).toBeNull();
  });
});
