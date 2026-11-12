import { Inject, Injectable } from '@nestjs/common';
import { PARTY_LINKS, type PartyLinks } from '../../guests/application/ports/party-links.port';
import { RsvpInvalidError } from '../domain/rsvp.errors';
import { DeliveryGuard, DeliveryMarker } from './deliveries.use-cases';
import { QR_RENDERER, type QrRenderer } from './ports/qr-renderer.port';

export type QrFormat = 'png' | 'pdf';

export interface QrFile {
  fileName: string;
  contentType: string;
  content: Buffer;
  /** Quantos grupos foram marcados como enviados (o Toast). */
  marked: number;
}

/**
 * POST …/parties/qr-codes (Envios RN09; decisão 217(9)): o QR aponta só para
 * o link do grupo. PNG com 1 grupo; PDF com um QR por página e o nome do
 * grupo. Baixar marca o envio do convite de todos os grupos do arquivo, com
 * `lastChannel = qr`, na mesma transação (as regras do convite: DELIVERIES_CLOSED,
 * 404 do grupo e o grupo_enviado no 1º envio).
 */
@Injectable()
export class DownloadQrCodes {
  constructor(
    private readonly guard: DeliveryGuard,
    private readonly marker: DeliveryMarker,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
    @Inject(QR_RENDERER) private readonly renderer: QrRenderer,
  ) {}

  async execute({
    userId,
    weddingId,
    partyIds,
    format,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyIds: readonly string[];
    format: QrFormat;
    now: Date;
  }): Promise<QrFile> {
    const unique = [...new Set(partyIds)];
    if (format === 'png' && unique.length > 1)
      throw new RsvpInvalidError({
        issues: [{ path: 'format', code: 'PNG_SINGLE_PARTY', params: {} }],
      });
    const wedding = await this.guard.open({ userId, weddingId, kind: 'invite', now });
    const { parties } = await this.marker.mark({
      userId,
      weddingId,
      partyIds: unique,
      kind: 'invite',
      channel: 'qr',
      now,
    });
    const pages = parties.map((party) => ({
      name: party.name,
      url: this.links.url({ slug: wedding.slug, token: party.linkToken }) ?? '',
    }));
    const slug = wedding.slug ?? 'casamento';
    if (format === 'png')
      return {
        fileName: `qr-${slug}.png`,
        contentType: 'image/png',
        content: await this.renderer.png({ url: pages[0].url }),
        marked: parties.length,
      };
    return {
      fileName: `qr-${slug}.pdf`,
      contentType: 'application/pdf',
      content: await this.renderer.pdf({ pages }),
      marked: parties.length,
    };
  }
}
