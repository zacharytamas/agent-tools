import { join, resolve, sep } from 'node:path'
import { FileSystem } from '@effect/platform'
import { layer as NodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect } from 'effect'
import { GitService } from './git.service'
import type { RepoId } from './repo-id'

export class RepoService extends Effect.Service<RepoService>()('RepoService', {
  effect: Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem

    const resolveRepoPath = (repoId: RepoId, path: string) => {
      const repoBasePath = git.basePath(repoId)
      const fullPath = resolve(repoBasePath, path)
      const baseWithSeparator = `${repoBasePath}${sep}`

      if (fullPath === repoBasePath || fullPath.startsWith(baseWithSeparator)) {
        return Effect.succeed(fullPath)
      }

      return Effect.fail(new Error('path must stay within repo base path'))
    }

    return {
      ls: (repoId: RepoId, path: string) =>
        Effect.gen(function* () {
          yield* git.clone(repoId)

          const fullyQualifiedPath = yield* resolveRepoPath(repoId, path)

          const entries = yield* fs.readDirectory(fullyQualifiedPath)

          const withTypes = yield* Effect.forEach(entries, (entry) =>
            Effect.gen(function* () {
              const info = yield* fs.stat(join(fullyQualifiedPath, entry))

              return info.type === 'Directory' ? `${entry}/` : entry
            }),
          )

          return withTypes.sort((a, b) => a.localeCompare(b))
        }),
    }
  }),
  dependencies: [GitService.Default, NodeFileSystemLayer],
}) {}
