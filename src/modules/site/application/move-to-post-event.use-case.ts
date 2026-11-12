import { Inject, Injectable } from '@nestjs/common';
import {
  POST_EVENT_TRANSITION,
  type PostEventTransition,
} from './ports/post-event-transition.port';

/**
 * Rotina diária do pós-evento (Publicação RN08; decisão 216, D4): o site
 * publicado passa a `post_event` no dia seguinte ao casamento, no fuso dele.
 * O pós-evento fecha o RSVP (RSVP RN08). O relógio vem de fora, para o teste.
 */
@Injectable()
export class MoveToPostEvent {
  constructor(@Inject(POST_EVENT_TRANSITION) private readonly transition: PostEventTransition) {}

  async execute({ now }: { now: Date }): Promise<{ moved: number }> {
    return { moved: (await this.transition.moveDue({ now })).length };
  }
}
