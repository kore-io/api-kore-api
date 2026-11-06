import type { OwnerlessWedding, OwnerlessWeddings } from './ports/ownerless-weddings.port';
import type { PurgeNotice, PurgeNoticeMailer } from './ports/purge-notice-mailer.port';
import { PurgeOwnerlessWeddings } from './purge-ownerless-weddings.use-case';

const day = 24 * 60 * 60 * 1000;
const lastActivityAt = new Date('2026-01-10T12:00:00Z');
const purgeDate = new Date('2026-07-10T12:00:00Z');
const base: OwnerlessWedding = {
  weddingId: 'w1',
  status: 'awaiting_couple',
  lastActivityAt,
  noticeSentAt: null,
  creator: { email: 'juliana@x.com', name: 'Juliana Prado' },
  partnerNames: ['Fernanda', 'João'],
};

function setup({ wedding, writes = true }: { wedding: OwnerlessWedding; writes?: boolean }) {
  const weddings = {
    listCandidates: jest.fn().mockResolvedValue([wedding]),
    markNoticeSent: jest.fn().mockResolvedValue(writes),
    purge: jest.fn().mockResolvedValue(writes),
  } satisfies OwnerlessWeddings;
  const sent: PurgeNotice[] = [];
  const mailer: PurgeNoticeMailer = {
    send: ({ notice }) => {
      sent.push(notice);
      return Promise.resolve();
    },
  };
  return { useCase: new PurgeOwnerlessWeddings(weddings, mailer), weddings, sent };
}

describe('PurgeOwnerlessWeddings (rotina diária; RN13 de Convites; decisão 180)', () => {
  it('decisão 180 - 30 dias antes da data, marca o aviso e manda o e-mail 6 com a data do expurgo', async () => {
    const { useCase, weddings, sent } = setup({ wedding: base });
    const now = new Date(purgeDate.getTime() - 30 * day);

    await expect(useCase.execute({ now })).resolves.toEqual({ notices: 1, purged: 0 });

    expect(weddings.markNoticeSent).toHaveBeenCalledWith({
      weddingId: 'w1',
      seenLastActivityAt: lastActivityAt,
      now,
    });
    expect(sent).toEqual([
      {
        to: 'juliana@x.com',
        creatorName: 'Juliana',
        partnerNames: ['Fernanda', 'João'],
        status: 'awaiting_couple',
        purgeDate,
      },
    ]);
  });

  it('atividade nova no meio do caminho (a marca não grava): sem e-mail', async () => {
    const { useCase, sent } = setup({ wedding: base, writes: false });

    await expect(useCase.execute({ now: purgeDate })).resolves.toEqual({ notices: 0, purged: 0 });
    expect(sent).toEqual([]);
  });

  it('decisão 180 - aviso no prazo: expurga na data, sem novo e-mail', async () => {
    const { useCase, weddings, sent } = setup({
      wedding: { ...base, noticeSentAt: new Date(purgeDate.getTime() - 30 * day) },
    });

    await expect(useCase.execute({ now: purgeDate })).resolves.toEqual({ notices: 0, purged: 1 });
    expect(weddings.purge).toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('decisão 180 - aviso atrasado: não expurga antes dos 30 dias prometidos', async () => {
    const { useCase, weddings } = setup({
      wedding: { ...base, noticeSentAt: new Date(purgeDate.getTime() + 5 * day) },
    });

    await expect(
      useCase.execute({ now: new Date(purgeDate.getTime() + 20 * day) }),
    ).resolves.toEqual({
      notices: 0,
      purged: 0,
    });
    expect(weddings.purge).not.toHaveBeenCalled();
  });
});
