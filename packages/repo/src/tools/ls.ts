import { Effect } from 'effect'
import { RepoService } from '../repo.service'
import type { RepoId } from '../repo-id'

const repo_ls = (repoId: RepoId, path: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* RepoService).ls(repoId, path)
    }).pipe(Effect.provide(RepoService.Default)),
  )

export default repo_ls
