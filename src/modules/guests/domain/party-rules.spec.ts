import { contactAfter, deliveryStatusAfter, hasPending, type GroupMember } from './party-rules';

const member = (overrides: Partial<GroupMember> & { id: string }): GroupMember => ({
  name: 'Alguém',
  isPlusOne: false,
  rsvpStatus: 'pending',
  phone: null,
  email: null,
  ...overrides,
});

describe('Contato do grupo (Grupos RN06)', () => {
  const celia = member({ id: 'celia', phone: '+5519998763310' });
  const luiz = member({ id: 'luiz' });
  const pedro = member({ id: 'pedro', email: 'pedro@exemplo.kore.local' });

  it('RN06 - o contato que continua no grupo, com telefone ou e-mail, fica', () => {
    expect(contactAfter({ currentContactId: 'celia', members: [luiz, celia, pedro] })).toBe(
      'celia',
    );
  });

  it('RN06 - o contato sai e o próximo com contato, na ordem do grupo, assume', () => {
    expect(contactAfter({ currentContactId: 'celia', members: [luiz, pedro] })).toBe('pedro');
  });

  it('RN06 - o contato que perde telefone e e-mail passa a vez; ninguém, fica sem contato', () => {
    expect(
      contactAfter({ currentContactId: 'celia', members: [{ ...celia, phone: null }, pedro] }),
    ).toBe('pedro');
    expect(
      contactAfter({ currentContactId: 'celia', members: [{ ...celia, phone: null }, luiz] }),
    ).toBeNull();
  });

  it('RN06 - grupo sem contato ganha o primeiro que passa a ter telefone ou e-mail', () => {
    expect(contactAfter({ currentContactId: null, members: [luiz, pedro] })).toBe('pedro');
  });
});

describe('Status de envio (Grupos RN10; decisão 199(1))', () => {
  const confirmed = member({ id: 'a', rsvpStatus: 'confirmed' });
  const pending = member({ id: 'b' });
  const emptySlot = member({ id: 'c', name: null, isPlusOne: true });

  it('RN10 - sem convidado com nome pendente, um grupo enviado fica respondido; a vaga não segura', () => {
    expect(
      deliveryStatusAfter({
        current: 'viewed',
        firstViewedAt: new Date(),
        members: [confirmed, emptySlot],
      }),
    ).toBe('responded');
  });

  it('RN10 - com pendente, o respondido volta a visualizado ou enviado', () => {
    expect(
      deliveryStatusAfter({
        current: 'responded',
        firstViewedAt: new Date(),
        members: [confirmed, pending],
      }),
    ).toBe('viewed');
    expect(
      deliveryStatusAfter({
        current: 'responded',
        firstViewedAt: null,
        members: [confirmed, pending],
      }),
    ).toBe('sent');
  });

  it('RN10 - um grupo não enviado não muda', () => {
    expect(
      deliveryStatusAfter({ current: 'not_sent', firstViewedAt: null, members: [confirmed] }),
    ).toBe('not_sent');
  });

  it('RN16 - a vaga pendente conta como pendente do grupo (decisão 199(1))', () => {
    expect(hasPending({ members: [confirmed, emptySlot] })).toBe(true);
    expect(hasPending({ members: [confirmed] })).toBe(false);
  });
});
