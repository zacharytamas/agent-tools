import { join } from 'node:path'
import { FileSystem } from '@effect/platform'
import { layer as NodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect } from 'effect'
import { ConfigService } from './config.service'
import type { RepoId } from './repo-id'

export class GitService extends Effect.Service<GitService>()('GitService', {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService
    const fs = yield* FileSystem.FileSystem

    const basePath = (repoId: RepoId) => join(config.dataPath, ...repoId)

    return {
      clone: (repoId: RepoId, _depth = 50) =>
        Effect.gen(function* () {
          const result = yield* fs.makeDirectory(basePath(repoId), {
            recursive: true,
          })
          return result
        }),
      pull: (_repoId: RepoId) => Effect.void,
      remove: (repoId: RepoId) =>
        fs.remove(basePath(repoId), { recursive: true, force: true }),
      basePath,
    }
  }),
  dependencies: [ConfigService.Default, NodeFileSystemLayer],
}) {}
