import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as RepoId from '../src/repo-id'
import { repo_ls } from '../src/tools'

describe('repo_ls', () => {
  let tempDataPath = ''
  const repoId = RepoId.make('github', 'zacharytamas', 'silo')

  beforeEach(() => {
    tempDataPath = mkdtempSync(join(tmpdir(), 'agent-tools-repo-'))
    process.env.AGENT_TOOLS_REPO_DATA_PATH = tempDataPath
  })

  afterEach(() => {
    delete process.env.AGENT_TOOLS_REPO_DATA_PATH
    rmSync(tempDataPath, { recursive: true, force: true })
  })

  test('returns deterministic sorted entries and marks directories', async () => {
    const repoBasePath = join(tempDataPath, ...repoId)
    mkdirSync(join(repoBasePath, 'src'), { recursive: true })
    writeFileSync(join(repoBasePath, 'README.md'), '# readme')
    writeFileSync(join(repoBasePath, 'src', 'index.ts'), 'export {}')

    const entries = await repo_ls(repoId, '.')

    expect(entries).toEqual(['README.md', 'src/'])
  })

  test('supports listing nested repo paths', async () => {
    const repoBasePath = join(tempDataPath, ...repoId)
    mkdirSync(join(repoBasePath, 'nested', 'deeper'), { recursive: true })
    writeFileSync(join(repoBasePath, 'nested', 'a.ts'), 'a')
    writeFileSync(join(repoBasePath, 'nested', 'deeper', 'b.ts'), 'b')

    const entries = await repo_ls(repoId, 'nested')

    expect(entries).toEqual(['a.ts', 'deeper/'])
  })

  test('rejects path traversal outside the repo root', async () => {
    await expect(repo_ls(repoId, '../')).rejects.toThrow(
      'path must stay within repo base path',
    )
  })
})
