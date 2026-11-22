import { plannerWeddingPath } from './planner-wedding-path';

describe('plannerWeddingPath (Meus casamentos RN08, decisões 260(1) e 310(1))', () => {
  it('o detalhe em Meus casamentos, com o id na query, e a URL do app preserva a query', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

    expect(plannerWeddingPath(id)).toBe(`/cerimonialista?casamento=${id}`);
    expect(new URL(plannerWeddingPath(id), 'https://app.kore.com.br').toString()).toBe(
      `https://app.kore.com.br/cerimonialista?casamento=${id}`,
    );
  });

  it('o id vai codificado', () => {
    expect(plannerWeddingPath('a&b=c')).toBe('/cerimonialista?casamento=a%26b%3Dc');
  });
});
