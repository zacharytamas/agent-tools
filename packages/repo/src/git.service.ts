import { Effect } from 'effect'

export class GitService extends Effect.Service<GitService>()('GitService', {
  effect: Effect.gen(function* () {
    return {
      clone: (repoUrl: string, depth = 50) => {},
      pull: (repoUrl: string) => {},
      remove: (repoUrl: string) => {},
    }
  }),
}) {}
