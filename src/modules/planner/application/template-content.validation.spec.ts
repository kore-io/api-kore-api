import { ContrastTooLowError } from '../../site/domain/site.errors';
import { validateTemplateContent } from './template-content.validation';

describe('Modelos do cerimonialista: o conteúdo por tipo (RN01, RN03 e RN04)', () => {
  it('Textos: limpa o texto e guarda só { text }; 5.000 em Nossa história e Hospedagem, 2.000 no Dress code', async () => {
    expect(
      await validateTemplateContent({
        kind: 'section_content',
        sectionType: 'lodging',
        content: { text: ' a\r\nb ' },
      }),
    ).toEqual({ ok: true, content: { text: 'a\nb' } });
    for (const [sectionType, max] of [
      ['story', 5000],
      ['lodging', 5000],
      ['dress_code', 2000],
    ] as const) {
      const at = (length: number) =>
        validateTemplateContent({
          kind: 'section_content',
          sectionType,
          content: { text: 'a'.repeat(length) },
        });
      expect((await at(max)).ok).toBe(true);
      expect((await at(max + 1)).ok).toBe(false);
    }
  });

  it('FAQ: de 1 a 30 perguntas, pergunta e resposta obrigatórias, campo a mais recusado', async () => {
    const questions = (n: number) =>
      Array.from({ length: n }, () => ({ question: 'P?', answer: 'R.' }));
    const check = (content: unknown) =>
      validateTemplateContent({ kind: 'faq', sectionType: null, content });

    expect((await check({ questions: questions(30) })).ok).toBe(true);
    expect((await check({ questions: questions(0) })).ok).toBe(false);
    expect((await check({ questions: questions(31) })).ok).toBe(false);
    expect((await check({ questions: questions(1), title: 'FAQ' })).ok).toBe(false);
  });

  it('Aparência: o guarda-corpo do contraste é o da Aparência do site', async () => {
    await expect(
      validateTemplateContent({
        kind: 'appearance',
        sectionType: null,
        content: {
          fontPairKey: 'leve',
          primaryColor: '#FFFFFF',
          accentColor: '#FFFFFF',
          backgroundMode: 'light',
        },
      }),
    ).rejects.toThrow(ContrastTooLowError);
  });
});
