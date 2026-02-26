import { Effect } from 'effect'

export class RepoService extends Effect.Service<RepoService>()('RepoService', {
  effect: Effect.gen(function* () {
    return {}
  }),
}) {}
