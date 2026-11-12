import { Inject, Injectable } from '@nestjs/common';
import {
  isValidSlugFormat,
  isReservedSlug,
  type SlugUnavailableReason,
} from '../domain/wedding-signup';
import { SLUG_REGISTRY, type SlugRegistry } from './ports/slug-registry.port';
import { SuggestSlug } from './suggest-slug.service';

export interface SlugAvailability {
  slug: string;
  available: boolean;
  reason: SlugUnavailableReason | null;
  suggestion: string | null;
}

/** Confere o endereço enquanto o casal digita (RN04 e RN05 de Cadastro). */
@Injectable()
export class CheckSlugAvailability {
  constructor(
    @Inject(SLUG_REGISTRY) private readonly slugs: SlugRegistry,
    private readonly suggestSlug: SuggestSlug,
  ) {}

  /**
   * Com `weddingId` (Editor do site, Dados básicos RN06), o endereço atual
   * daquele casamento volta como livre, se a pessoa tiver vínculo com ele.
   */
  async execute({
    slug,
    eventDate,
    weddingId,
  }: {
    slug: string;
    eventDate: Date | null;
    weddingId?: string;
  }): Promise<SlugAvailability> {
    if (!isValidSlugFormat({ slug }))
      return { slug, available: false, reason: 'invalid_format', suggestion: null };
    const reason: SlugUnavailableReason | null = isReservedSlug({ slug })
      ? 'reserved'
      : (await this.slugs.isTaken({ slug })) && !(await this.isCurrentOf({ slug, weddingId }))
        ? 'taken'
        : null;
    if (!reason) return { slug, available: true, reason: null, suggestion: null };
    return {
      slug,
      available: false,
      reason,
      suggestion: await this.suggestSlug.execute({ slug, eventDate }),
    };
  }

  private async isCurrentOf({
    slug,
    weddingId,
  }: {
    slug: string;
    weddingId?: string;
  }): Promise<boolean> {
    if (!weddingId) return false;
    const current = await this.slugs.currentSlugOf({ weddingId });
    return current !== null && current.toLowerCase() === slug;
  }
}
