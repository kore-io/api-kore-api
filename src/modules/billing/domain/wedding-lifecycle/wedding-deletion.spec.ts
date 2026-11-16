import { confirmNameMatches, deletionDayFor } from './wedding-deletion';

describe('Excluir o casamento (Retenção e expurgo RN05)', () => {
  it('RN05 - o expurgo fica para hoje + 7 dias', () => {
    expect(deletionDayFor({ today: '2026-11-14' })).toBe('2026-11-21');
    expect(deletionDayFor({ today: '2026-12-28' })).toBe('2027-01-04');
  });

  it('RN05 - o nome digitado confere sem contar maiúsculas e espaços a mais', () => {
    const weddingName = 'Ana & Marcos';
    expect(confirmNameMatches({ confirmName: 'Ana & Marcos', weddingName })).toBe(true);
    expect(confirmNameMatches({ confirmName: '  ana &   MARCOS ', weddingName })).toBe(true);
    expect(confirmNameMatches({ confirmName: 'Ana e Marcos', weddingName })).toBe(false);
    expect(confirmNameMatches({ confirmName: 'Ana & Márcos', weddingName })).toBe(false);
    expect(confirmNameMatches({ confirmName: '', weddingName })).toBe(false);
  });
});
