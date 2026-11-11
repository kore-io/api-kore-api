import {
  comparableName,
  findDuplicateGuest,
  parsePastedList,
  pastedGuestCount,
} from './paste-list';

const names = (text: string) =>
  parsePastedList({ text }).groups.map((group) => ({
    name: group.name,
    guests: group.guests.map((guest) => guest.name),
    warnings: group.warnings,
  }));

describe('Lista colada (Importação RN10 e RN11)', () => {
  it('RN10 - o exemplo do contrato: grupo com ":", "+ N", casal com " e " e pessoa sozinha', () => {
    const { groups, droppedLines } = parsePastedList({
      text: 'Família Moreira: Jorge, Célia, Pedro\nCarla Nunes + 2 filhos\n\nRafael e Bianca\nMárcia Rocha',
    });

    expect(groups.map(({ line, name, guests }) => ({ line, name, guests }))).toEqual([
      {
        line: 1,
        name: 'Família Moreira',
        guests: [{ name: 'Jorge' }, { name: 'Célia' }, { name: 'Pedro' }],
      },
      {
        line: 2,
        name: 'Carla Nunes',
        guests: [{ name: 'Carla Nunes' }, { name: null }, { name: null }],
      },
      { line: 4, name: 'Rafael e Bianca', guests: [{ name: 'Rafael' }, { name: 'Bianca' }] },
      { line: 5, name: 'Márcia Rocha', guests: [{ name: 'Márcia Rocha' }] },
    ]);
    expect(droppedLines).toEqual([]);
    expect(pastedGuestCount({ groups })).toBe(9);
  });

  it('RN10 - só o primeiro ":" separa o grupo', () => {
    expect(names('Mesa 1: 20:30')).toEqual([{ name: 'Mesa 1', guests: ['20:30'], warnings: [] }]);
  });

  it('RN10 - vírgula, " e " sem diferenciar maiúsculas, "&" e "/" separam pessoas; "Maria e Silva" vira duas', () => {
    expect(names('Amigos: Ana E Bia & Caio / Dani, Maria e Silva')[0].guests).toEqual([
      'Ana',
      'Bia',
      'Caio',
      'Dani',
      'Maria',
      'Silva',
    ]);
  });

  it('RN10 - "+1" e "+ 3" sem palavra depois; o "+ N" depois do ":"', () => {
    expect(names('Ana +1')[0].guests).toEqual(['Ana', null]);
    expect(names('Primos: Felipe + 3')[0]).toEqual({
      name: 'Primos',
      guests: ['Felipe', null, null, null],
      warnings: [],
    });
  });

  it('RN10 - linha só com "+ N": o grupo vem com nome nulo e N pessoas sem nome', () => {
    expect(names('+ 2')).toEqual([{ name: null, guests: [null, null], warnings: [] }]);
  });

  it('RN10 - "+ N" fora de 1 a 20 avisa e não cria as pessoas sem nome; sem ninguém, a linha sai', () => {
    expect(names('Carla Nunes + 99')).toEqual([
      { name: 'Carla Nunes', guests: ['Carla Nunes'], warnings: ['PLUS_OUT_OF_RANGE'] },
    ]);
    const { groups, droppedLines } = parsePastedList({ text: 'Ana\n+ 0\n+ 21 primos' });
    expect(groups).toHaveLength(1);
    expect(droppedLines).toEqual([2, 3]);
  });

  it('RN06 - o nome repetido no mesmo grupo sai (sem diferenciar maiúsculas, acentos e espaços)', () => {
    expect(names('Família: Célia, celia ,  CÉLIA, Luiz')).toEqual([
      { name: 'Família', guests: ['Célia', 'Luiz'], warnings: ['DUPLICATE_REMOVED'] },
    ]);
  });

  it('RN14 (decisão 210(4)) - conta cada nome repetido que saiu do grupo, e zero sem repetição', () => {
    const { groups } = parsePastedList({ text: 'Jorge, jorge, JORGE\nAna e Ana\nRafael e Bianca' });
    expect(groups.map((group) => group.duplicatesRemoved)).toEqual([2, 1, 0]);
  });

  it('RN11 - nome de pessoa ou de grupo acima de 80 avisa TOO_LONG e fica para corrigir', () => {
    expect(names(`${'G'.repeat(81)}: Ana`)[0].warnings).toEqual(['TOO_LONG']);
    expect(names(`Grupo: ${'a'.repeat(81)}`)[0].warnings).toEqual(['TOO_LONG']);
    expect(names(`Grupo: ${'a'.repeat(80)}`)[0].warnings).toEqual([]);
  });

  it('RN10 - cada linha é um grupo, mesmo com nome repetido', () => {
    expect(names('Família Silva\nFamília Silva')).toHaveLength(2);
  });
});

describe('comparableName e findDuplicateGuest (RN06, RN11)', () => {
  it('compara sem maiúsculas, acentos e espaços', () => {
    expect(comparableName('  Família   MOREIRA ')).toBe('familia moreira');
  });

  it('acha o primeiro nome repetido no mesmo grupo; em grupos diferentes, não', () => {
    expect(
      findDuplicateGuest({
        groups: [{ guests: ['Ana', 'Bia'] }, { guests: ['Ana', 'Caio', ' ANA '] }],
      }),
    ).toEqual({ group: 1, guest: 2 });
    expect(findDuplicateGuest({ groups: [{ guests: ['Ana'] }, { guests: ['Ana'] }] })).toBeNull();
  });
});
