import type { Prisma } from '../../../../generated/prisma/client';
import type { ObjectStorage } from '../../../../shared/storage/application/object-storage.port';
import { siteImageKeys } from '../../../site/domain/site-image';

/**
 * Apaga os dados de um casamento e deixa a lápide (Convites RN13; decisão
 * 207(17)), na transação do backoffice já com o casamento travado. É a rotina
 * do expurgo de casamento sem dono, também usada pelo Excluir este casamento
 * (Meus casamentos RN11; revisão C2-5). Devolve os tokens das chaves das imagens do site, cujos
 * arquivos quem chama apaga (dentro da transação, no expurgo; depois do
 * commit, no Excluir).
 */
export async function purgeWeddingData({
  tx,
  weddingId,
  now,
}: {
  tx: Prisma.TransactionClient;
  weddingId: string;
  now: Date;
}): Promise<string[]> {
  await tx.accessInvitation.deleteMany({ where: { weddingId } });
  await tx.membership.deleteMany({ where: { weddingId } });
  await tx.partner.deleteMany({ where: { weddingId } });
  // A lápide fica, então o cascade do Wedding não dispara: as filhas da F1 saem
  // à mão, das folhas para a raiz (decisão 207(17)).
  // As F4 e F5: notificações, estado do e-mail, preferências, histórico de
  // respostas e de envios e mensagens prontas.
  await tx.notification.deleteMany({ where: { weddingId } });
  await tx.notificationEmailState.deleteMany({ where: { weddingId } });
  await tx.notificationPreference.deleteMany({ where: { weddingId } });
  await tx.guestResponse.deleteMany({ where: { weddingId } });
  await tx.rsvpSubmission.deleteMany({ where: { weddingId } });
  await tx.partyDelivery.deleteMany({ where: { weddingId } });
  await tx.messageTemplate.deleteMany({ where: { weddingId } });
  await tx.guestTag.deleteMany({ where: { weddingId } });
  await tx.partyTag.deleteMany({ where: { weddingId } });
  await tx.guest.deleteMany({ where: { weddingId } });
  await tx.party.deleteMany({ where: { weddingId } });
  await tx.tag.deleteMany({ where: { weddingId } });
  await tx.weddingStats.deleteMany({ where: { weddingId } });
  // O site (Imagens do site RN11): seções, conteúdos e imagens com os arquivos.
  await tx.sitePreviewToken.deleteMany({ where: { weddingId } });
  await tx.sectionContent.deleteMany({ where: { weddingId } });
  await tx.section.deleteMany({ where: { weddingId } });
  const images = await tx.siteImage.findMany({ where: { weddingId }, select: { keyToken: true } });
  await tx.siteImage.deleteMany({ where: { weddingId } });
  // Lápide (Modelo de Dados): ficam id, status, purgedAt, o indicador e createdAt.
  await tx.wedding.update({
    where: { id: weddingId },
    data: {
      status: 'purged',
      purgedAt: now,
      slug: null,
      eventDate: null,
      timezone: null,
      city: null,
      state: null,
      createdByUserId: null,
      signupSource: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      purgeNoticeSentAt: null,
      // Sem contato, aparência nem capa (Imagens do site RN11).
      contactEmail: null,
      contactWhatsapp: null,
      coverImageId: null,
      siteUpdatedAt: null,
      fontPairKey: null,
      starterPaletteKey: null,
      primaryColor: null,
      accentColor: null,
      backgroundMode: null,
      appearanceSetAt: null,
      // Prazo, pergunta de música e publicação (F4).
      rsvpDeadline: null,
      songQuestionEnabled: false,
      songQuestionText: null,
      endDate: null,
      publicationSource: null,
      publishedByUserId: null,
    },
  });
  return images.map(({ keyToken }) => keyToken);
}

/** Os arquivos das imagens do site (Imagens do site RN11): as chaves não levam o casamento. */
export async function deleteSiteImageObjects({
  storage,
  imageKeyTokens,
}: {
  storage: ObjectStorage;
  imageKeyTokens: readonly string[];
}): Promise<void> {
  if (imageKeyTokens.length === 0) return;
  const keys = imageKeyTokens.map((keyToken) => siteImageKeys({ keyToken }));
  await storage.delete({ bucket: 'private', keys: keys.map((key) => key.original) });
  await storage.delete({
    bucket: 'public',
    keys: keys.flatMap((key) => [key.display, key.thumb, key.og]),
  });
}
