import { checklist, daysUntilEvent, partiesTotal } from './dashboard';

const none = { parties: 0, guests: 0, notReminded: 0 };

describe('Dashboard (RN01 a RN03)', () => {
  it('RN03 - antes de publicar: convidados e aparência feitos; o lembrete não aparece', () => {
    const delivery = { notSent: 58, sent: 0, viewed: 0, responded: 0 };
    expect(
      checklist({ delivery, reminderQueue: none, appearanceSet: true, published: false }),
    ).toEqual([
      { key: 'guests', done: true, progress: null },
      { key: 'appearance', done: true, progress: null },
      { key: 'publish', done: false, progress: null },
      { key: 'invites', done: false, progress: { done: 0, total: 58 } },
    ]);
  });

  it('RN03 - os envios (52 de 58) e o lembrete com a fila (15 sem lembrete)', () => {
    const delivery = { notSent: 6, sent: 5, viewed: 4, responded: 43 };
    const items = checklist({
      delivery,
      reminderQueue: { parties: 15, guests: 22, notReminded: 15 },
      appearanceSet: true,
      published: true,
    });
    expect(items.slice(3)).toEqual([
      { key: 'invites', done: false, progress: { done: 52, total: 58 } },
      { key: 'reminders', done: false, progress: { done: 0, total: 15 } },
    ]);
    expect(partiesTotal({ delivery })).toBe(58);
  });

  it('RN03 - todos enviados (o respondido sem envio conta); a fila toda lembrada; sem grupos, os envios não ficam feitos', () => {
    const items = checklist({
      delivery: { notSent: 0, sent: 10, viewed: 5, responded: 43 },
      reminderQueue: { parties: 15, guests: 22, notReminded: 0 },
      appearanceSet: true,
      published: true,
    });
    expect(items.find((item) => item.key === 'invites')?.done).toBe(true);
    expect(items.find((item) => item.key === 'reminders')?.done).toBe(true);
    expect(
      checklist({
        delivery: { notSent: 0, sent: 0, viewed: 0, responded: 0 },
        reminderQueue: none,
        appearanceSet: false,
        published: true,
      }).find((item) => item.key === 'invites')?.done,
    ).toBe(false);
  });

  it('RN01 - os dias até o casamento, no fuso dele', () => {
    const now = new Date('2026-11-14T02:30:00Z'); // 13/11 às 23h30 em São Paulo
    expect(daysUntilEvent({ eventDate: '2026-11-14', timezone: 'America/Sao_Paulo', now })).toBe(1);
    expect(daysUntilEvent({ eventDate: null, timezone: null, now })).toBeNull();
  });
});
