import {
  deliveriesClosedReason,
  longDate,
  mailtoUrl,
  renderMessage,
  whatsappUrl,
} from './deliveries';

const NOW = new Date('2026-10-16T12:00:00Z');

describe('Envios (Envios RN01, RN06 e RN07)', () => {
  it('RN01 - o convite e o save the date só publicados; o lembrete também com o prazo aberto; o pós-evento fecha', () => {
    const base = { rsvpDeadline: '2026-10-15', timezone: 'America/Sao_Paulo', now: NOW };
    expect(deliveriesClosedReason({ ...base, kind: 'invite', status: 'draft' })).toBe(
      'not_published',
    );
    expect(deliveriesClosedReason({ ...base, kind: 'invite', status: 'published' })).toBeNull();
    expect(deliveriesClosedReason({ ...base, kind: 'reminder', status: 'published' })).toBe(
      'deadline_passed',
    );
    expect(
      deliveriesClosedReason({
        ...base,
        kind: 'reminder',
        status: 'published',
        rsvpDeadline: null,
      }),
    ).toBeNull();
    expect(deliveriesClosedReason({ ...base, kind: 'save_the_date', status: 'post_event' })).toBe(
      'post_event',
    );
    // Data de saída do ar RN07: na carência, só leitura; expirado, motivo próprio.
    expect(deliveriesClosedReason({ ...base, kind: 'invite', status: 'grace' })).toBe('post_event');
    expect(deliveriesClosedReason({ ...base, kind: 'invite', status: 'expired' })).toBe(
      'site_expired',
    );
  });

  it('RN06 (R4-4) - marcadores numa passada só: o grupo chamado "{link}" não vira o link', () => {
    const text = renderMessage({
      body: 'Oi, {nome_do_grupo}! Dia {data}. Responda: {link} ({prazo}) {outro}',
      values: {
        partyName: '{link}',
        eventDate: '14 de novembro',
        link: 'https://kore.com.br/ana-e-marcos/grupo/abc',
        site: 'kore.com.br/ana-e-marcos',
        deadline: '',
      },
    });
    expect(text).toBe(
      'Oi, {link}! Dia 14 de novembro. Responda: https://kore.com.br/ana-e-marcos/grupo/abc () {outro}',
    );
  });

  it('RN06 - a data por extenso, sem o ano', () => {
    expect(longDate({ day: '2026-11-14' })).toBe('14 de novembro');
    expect(longDate({ day: '2026-10-01' })).toBe('1 de outubro');
  });

  it('RN07 - as URLs prontas, com encodeURIComponent em cada parâmetro', () => {
    expect(whatsappUrl({ phone: '+5519998763310', text: 'Oi & tchau\n#1' })).toBe(
      'https://wa.me/5519998763310?text=Oi%20%26%20tchau%0A%231',
    );
    expect(
      mailtoUrl({ email: 'celia+casamento@gmail.com', subject: 'Convite & data', text: 'a=b' }),
    ).toBe('mailto:celia%2Bcasamento@gmail.com?subject=Convite%20%26%20data&body=a%3Db');
  });
});
