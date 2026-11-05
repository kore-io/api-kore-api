import type { ProductEventRecorder } from '../../product-events/application/ports/product-event-recorder.port';
import {
  CoupleInvitationsFullError,
  InvalidInvitationRecipientsError,
  OwnersFullError,
  WeddingActionForbiddenError,
} from '../domain/access.errors';
import type {
  AccessInvitationStore,
  InvitationWeddingDetails,
  Inviter,
  NewAccessInvitation,
  PendingInvitation,
} from './ports/access-invitation-store.port';
import type { InvitationEmail, InvitationMailer } from './ports/invitation-mailer.port';
import { SendAccessInvitations } from './send-access-invitations.use-case';
import type { WeddingAuthorization } from './wedding-authorization.service';

const coupleWedding: InvitationWeddingDetails = {
  status: 'draft',
  createdByUserId: 'u-ana',
  createdByReferrer: false,
  activeOwners: 1,
  activeCollaborators: 0,
  partnerNames: ['Ana Beatriz', 'Marcos'],
  eventDate: null,
  city: 'Campinas',
  state: 'SP',
};
const plannerWedding: InvitationWeddingDetails = {
  ...coupleWedding,
  createdByUserId: 'u-juliana',
  createdByReferrer: true,
  activeOwners: 0,
  activeCollaborators: 1,
};
const juliana: Inviter = {
  partnerName: null,
  userName: 'Juliana Prado',
  referrerKind: 'planner',
  creditName: 'Prado Assessoria',
};

function setup({
  wedding = coupleWedding,
  pending = [],
  inviter = { partnerName: 'Ana Beatriz', userName: 'Ana', referrerKind: null, creditName: null },
  role = 'owner',
}: {
  wedding?: InvitationWeddingDetails;
  pending?: PendingInvitation[];
  inviter?: Inviter;
  role?: 'owner' | 'collaborator';
} = {}) {
  const inserted: NewAccessInvitation[] = [];
  const superseded: string[] = [];
  const emails: InvitationEmail[] = [];
  const store: AccessInvitationStore = {
    lockWedding: jest.fn().mockResolvedValue(undefined),
    loadWedding: jest.fn().mockResolvedValue(wedding),
    loadInviter: jest.fn().mockResolvedValue(inviter),
    listPending: jest.fn().mockResolvedValue(pending),
    supersede: jest.fn(({ invitationIds }: { invitationIds: string[] }) => {
      superseded.push(...invitationIds);
      return Promise.resolve();
    }),
    insert: jest.fn(({ invitations }: { invitations: NewAccessInvitation[] }) => {
      inserted.push(...invitations);
      return Promise.resolve();
    }),
    markAwaitingCouple: jest.fn().mockResolvedValue(undefined),
    touchActivity: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(),
    revoke: jest.fn(),
  };
  const mailer: InvitationMailer = {
    send: jest.fn(({ email }: { email: InvitationEmail }) => {
      emails.push(email);
      return Promise.resolve();
    }),
    urlFor: ({ token }) => `http://app/convite/${token}`,
  };
  let next = 0;
  const tokens = {
    generate: () => ({ token: `t${++next}`, tokenHash: `h${next}` }),
    hash: ({ token }: { token: string }) => `h-${token}`,
  };
  const productEvents: ProductEventRecorder = { record: jest.fn().mockResolvedValue(undefined) };
  // Depois do commit (decisão 170): o teste roda as tarefas quando quiser.
  const scheduled: (() => Promise<void>)[] = [];
  const afterCommit = { schedule: (work: () => Promise<void>) => void scheduled.push(work) };
  const commit = async () => {
    for (const work of scheduled.splice(0)) await work();
  };
  const authorization = {
    require: jest.fn().mockResolvedValue(role),
  } as unknown as WeddingAuthorization;
  const useCase = new SendAccessInvitations(
    authorization,
    store,
    tokens,
    mailer,
    productEvents,
    afterCommit,
  );
  return { useCase, store, inserted, superseded, emails, productEvents, authorization, commit };
}

const now = new Date('2026-11-06T12:00:00Z');
const future = new Date('2026-12-01T00:00:00Z');
const past = new Date('2026-11-01T00:00:00Z');
const base = { userId: 'u-ana', weddingId: 'w1', message: null, now };

describe('SendAccessInvitations (POST /v1/weddings/{weddingId}/access-invitations)', () => {
  it('RN01 e RN03 - o dono convida o parceiro: dono, 30 dias, token só em hash, e-mail enviado', async () => {
    const { useCase, inserted, emails, store, commit } = setup();

    const [sent] = await useCase.execute({ ...base, kind: 'partner', emails: ['Marcos@X.com'] });
    expect(emails).toEqual([]); // decisão 170: nada sai antes do commit
    await commit();

    expect(inserted).toEqual([
      expect.objectContaining({
        kind: 'partner',
        email: 'marcos@x.com',
        role: 'owner',
        tokenHash: 'h1',
        invitedByUserId: 'u-ana',
        expiresAt: new Date('2026-12-06T12:00:00Z'),
      }),
    ]);
    expect(sent).toMatchObject({ email: 'marcos@x.com', resent: false });
    expect(sent).not.toHaveProperty('url');
    expect(emails).toEqual([
      expect.objectContaining({ to: 'marcos@x.com', token: 't1', resent: false }),
    ]);
    expect(store.touchActivity).toHaveBeenCalledWith({ weddingId: 'w1', now });
  });

  it('RN04 - reenviar ao mesmo e-mail substitui o pendente e avisa que o link anterior caiu', async () => {
    const { useCase, superseded, emails, commit } = setup({
      pending: [{ id: 'old', kind: 'partner', email: 'marcos@x.com', expiresAt: future }],
    });

    const [sent] = await useCase.execute({ ...base, kind: 'partner', emails: ['marcos@x.com'] });
    await commit();

    expect(superseded).toEqual(['old']);
    expect(sent?.resent).toBe(true);
    expect(emails[0]?.resent).toBe(true);
  });

  it('RN02 - dado o casamento com 2 donos, então OWNERS_FULL', async () => {
    const { useCase, store } = setup({ wedding: { ...coupleWedding, activeOwners: 2 } });

    await expect(
      useCase.execute({ ...base, kind: 'partner', emails: ['m@x.com'] }),
    ).rejects.toThrow(OwnersFullError);
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('RN01 - mais de um e-mail fora do convite do casal dá 400', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ ...base, kind: 'planner', emails: ['a@x.com', 'b@x.com'] }),
    ).rejects.toThrow(InvalidInvitationRecipientsError);
  });

  it('RN02 - o convite do casal por quem não é o indicador que criou é proibido', async () => {
    const { useCase } = setup({ wedding: coupleWedding });

    await expect(useCase.execute({ ...base, kind: 'couple', emails: ['a@x.com'] })).rejects.toThrow(
      WeddingActionForbiddenError,
    );
  });

  it('RN04 (decisão 170) - no do casal, o envio substitui só o pendente dos e-mails listados, e o casamento fica aguardando o casal', async () => {
    const { useCase, superseded, inserted, store } = setup({
      wedding: plannerWedding,
      inviter: juliana,
      role: 'collaborator',
      pending: [
        { id: 'fernanda-velho', kind: 'couple', email: 'fernanda@x.com', expiresAt: future },
        { id: 'joao-pendente', kind: 'couple', email: 'joao@x.com', expiresAt: future },
        { id: 'link', kind: 'couple', email: null, expiresAt: future },
      ],
    });

    const sent = await useCase.execute({
      ...base,
      userId: 'u-juliana',
      kind: 'couple',
      emails: ['fernanda@x.com'],
    });

    expect(superseded).toEqual(['fernanda-velho']);
    expect(inserted.map(({ email }) => email)).toEqual(['fernanda@x.com']);
    expect(sent[0]?.resent).toBe(true);
    expect(store.markAwaitingCouple).toHaveBeenCalledWith({ weddingId: 'w1' });
  });

  it('decisão 170(4) - com 2 convites do casal pendentes e não vencidos, um terceiro e-mail dá COUPLE_INVITATIONS_FULL', async () => {
    const { useCase, store } = setup({
      wedding: plannerWedding,
      inviter: juliana,
      role: 'collaborator',
      pending: [
        { id: 'f', kind: 'couple', email: 'fernanda@x.com', expiresAt: future },
        { id: 'j', kind: 'couple', email: 'joao@x.com', expiresAt: future },
        { id: 'link', kind: 'couple', email: null, expiresAt: future },
      ],
    });

    await expect(
      useCase.execute({ ...base, userId: 'u-juliana', kind: 'couple', emails: ['outra@x.com'] }),
    ).rejects.toThrow(CoupleInvitationsFullError);
    expect(store.supersede).not.toHaveBeenCalled();
  });

  it('decisão 170(4) - o vencido não conta, e reenviar a um dos dois pendentes passa', async () => {
    const pending = [
      { id: 'f', kind: 'couple' as const, email: 'fernanda@x.com', expiresAt: future },
      { id: 'j', kind: 'couple' as const, email: 'joao@x.com', expiresAt: past },
    ];
    const other = setup({
      wedding: plannerWedding,
      inviter: juliana,
      role: 'collaborator',
      pending,
    });
    await other.useCase.execute({
      ...base,
      userId: 'u-juliana',
      kind: 'couple',
      emails: ['outra@x.com'],
    });

    const resend = setup({
      wedding: plannerWedding,
      inviter: juliana,
      role: 'collaborator',
      pending,
    });
    await resend.useCase.execute({
      ...base,
      userId: 'u-juliana',
      kind: 'couple',
      emails: ['joao@x.com', 'fernanda@x.com'],
    });
    expect(resend.superseded.sort()).toEqual(['f', 'j']);
  });

  it('RN14 - o link do casal sem e-mail devolve a URL, não manda e-mail, substitui o link anterior e registra cerim_link_gerado', async () => {
    const { useCase, superseded, emails, productEvents, commit } = setup({
      wedding: { ...plannerWedding, status: 'awaiting_couple' },
      inviter: juliana,
      role: 'collaborator',
      pending: [
        { id: 'link-velho', kind: 'couple', email: null, expiresAt: future },
        { id: 'email', kind: 'couple', email: 'ana@x.com', expiresAt: future },
      ],
    });

    const [sent] = await useCase.execute({
      ...base,
      userId: 'u-juliana',
      kind: 'couple',
      emails: [],
    });
    expect(productEvents.record).not.toHaveBeenCalled(); // só depois do commit (decisão 170)
    await commit();

    expect(sent).toMatchObject({ email: null, resent: true, url: 'http://app/convite/t1' });
    expect(superseded).toEqual(['link-velho']);
    expect(emails).toEqual([]);
    expect(productEvents.record).toHaveBeenCalledWith({
      event: { name: 'cerim_link_gerado', weddingId: 'w1' },
      occurredAt: now,
    });
  });

  it('RN14 - o link gerado pelo vendedor não registra cerim_link_gerado', async () => {
    const { useCase, productEvents, commit } = setup({
      wedding: plannerWedding,
      inviter: { ...juliana, referrerKind: 'seller', creditName: null },
      role: 'collaborator',
    });

    await useCase.execute({ ...base, userId: 'u-juliana', kind: 'couple', emails: [] });
    await commit();

    expect(productEvents.record).not.toHaveBeenCalled();
  });
});
