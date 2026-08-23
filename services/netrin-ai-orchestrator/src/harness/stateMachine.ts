import { AiRouteError } from '../errors.js'

export type RouteAgentState =
  | 'received'
  | 'normalized'
  | 'constraints_extracted'
  | 'poi_candidates'
  | 'ambiguity_pending'
  | 'resolved'
  | 'ordered'
  | 'route_planned'
  | 'user_review'
  | 'draft_created'
  | 'cancelled'
  | 'failed'

const ALLOWED_TRANSITIONS: Record<RouteAgentState, readonly RouteAgentState[]> = {
  received: ['normalized', 'cancelled', 'failed'],
  normalized: ['constraints_extracted', 'cancelled', 'failed'],
  constraints_extracted: ['poi_candidates', 'cancelled', 'failed'],
  poi_candidates: ['ambiguity_pending', 'resolved', 'cancelled', 'failed'],
  ambiguity_pending: ['resolved', 'cancelled', 'failed'],
  resolved: ['ordered', 'cancelled', 'failed'],
  ordered: ['route_planned', 'cancelled', 'failed'],
  route_planned: ['user_review', 'cancelled', 'failed'],
  user_review: ['draft_created', 'cancelled', 'failed'],
  draft_created: [],
  cancelled: [],
  failed: []
}

export class RouteAgentStateMachine {
  #state: RouteAgentState = 'received'

  get state(): RouteAgentState {
    return this.#state
  }

  transition(next: RouteAgentState): void {
    if (!ALLOWED_TRANSITIONS[this.#state].includes(next)) {
      throw new AiRouteError('AI_INTERNAL_ERROR', 500)
    }
    this.#state = next
  }
}
