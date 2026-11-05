import { Inject, Injectable } from '@nestjs/common';
import { RESERVED_SLUGS, slugAlternatives } from '../domain/wedding-signup';
import { SLUG_REGISTRY, type SlugRegistry } from './ports/slug-registry.port';

/** Tentativas antes de desistir de sugerir (cada uma é uma consulta). */
const MAX_ATTEMPTS = 20;

/** RN05 de Cadastro: a primeira alternativa livre e não reservada (decisão 166). */
@Injectable()
export class SuggestSlug {
  constructor(@Inject(SLUG_REGISTRY) private readonly slugs: SlugRegistry) {}

  async execute({
    slug,
    eventDate,
  }: {
    slug: string;
    eventDate: Date | null;
  }): Promise<string | null> {
    let attempts = 0;
    for (const candidate of slugAlternatives({ slug, eventDate })) {
      if (attempts++ >= MAX_ATTEMPTS) return null;
      if (RESERVED_SLUGS.has(candidate)) continue;
      if (!(await this.slugs.isTaken({ slug: candidate }))) return candidate;
    }
    return null;
  }
}
