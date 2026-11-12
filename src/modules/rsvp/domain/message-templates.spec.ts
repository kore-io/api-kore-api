import { defaultMessage, requiresLink } from './message-templates';

describe('Mensagens prontas (Envios RN06)', () => {
  const base = { city: 'Campinas', coupleNames: 'Ana & Marcos', hasDeadline: false };

  it('RN06 - o convite padrão, com a cidade e os nomes do casal já trocados e o {link}', () => {
    expect(defaultMessage({ ...base, kind: 'invite' })).toEqual({
      subject: 'Convite do casamento de Ana & Marcos',
      body: 'Oi, {nome_do_grupo}! Vamos nos casar no dia {data}, em Campinas, e contamos com a sua presença.\nA confirmação é por este link: {link}\n\nCom carinho, Ana & Marcos',
    });
  });

  it('RN06 - o save the date leva o {site}, sem o link do grupo', () => {
    const { subject, body } = defaultMessage({ ...base, kind: 'save_the_date' });
    expect(subject).toBe('Data marcada: casamento de Ana & Marcos');
    expect(body).toContain('{site}');
    expect(body).not.toContain('{link}');
  });

  it('RN06 - o lembrete tem a versão com prazo e a sem prazo', () => {
    expect(defaultMessage({ ...base, kind: 'reminder', hasDeadline: true }).body).toContain(
      'Dá para confirmar até {prazo} por este link: {link}',
    );
    expect(defaultMessage({ ...base, kind: 'reminder' }).body).toContain(
      'A confirmação é por este link: {link}',
    );
    expect(defaultMessage({ ...base, kind: 'reminder' }).subject).toBe(
      'Lembrete: confirmação do casamento de Ana & Marcos',
    );
  });

  it('RN06 (D15) - o {link} é obrigatório no convite e no lembrete', () => {
    expect(requiresLink({ kind: 'invite' })).toBe(true);
    expect(requiresLink({ kind: 'reminder' })).toBe(true);
    expect(requiresLink({ kind: 'save_the_date' })).toBe(false);
  });
});
