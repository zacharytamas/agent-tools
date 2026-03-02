import { describe, expect, test } from 'bun:test'
import * as RepoId from '../src/repo-id'

describe('RepoId', () => {
  test('make creates a valid RepoId tuple', () => {
    const repoId = RepoId.make('github', 'zacharytamas', 'silo')

    expect(repoId).toEqual(['github', 'zacharytamas', 'silo'])
  })

  test('parse accepts a valid RepoId', () => {
    const parsed = RepoId.parse(['github', 'zacharytamas', 'silo'])

    expect(parsed).toEqual(['github', 'zacharytamas', 'silo'])
  })

  test('parse rejects invalid provider id', () => {
    expect(() => RepoId.parse(['gitlab', 'zacharytamas', 'silo'])).toThrow()
  })

  test('isRepoId returns expected validity for known cases', () => {
    expect(RepoId.isRepoId(['github', 'zacharytamas', 'silo'])).toBe(true)
    expect(RepoId.isRepoId(['gitlab', 'zacharytamas', 'silo'])).toBe(false)
    expect(RepoId.isRepoId(['github', 'zacharytamas'])).toBe(false)
    expect(RepoId.isRepoId('github/zacharytamas/silo')).toBe(false)
  })

  test('isRepoId stays consistent with parse over representative inputs', () => {
    const cases: unknown[] = [
      ['github', 'zacharytamas', 'silo'],
      ['gitlab', 'zacharytamas', 'silo'],
      ['github', 'zacharytamas'],
      ['github', 123, 'silo'],
      ['github', 'zacharytamas', null],
      null,
      undefined,
      'github/zacharytamas/silo',
      { providerId: 'github', userId: 'zacharytamas', repoName: 'silo' },
    ]

    for (const value of cases) {
      const parseAccepts = (() => {
        try {
          RepoId.parse(value)
          return true
        } catch {
          return false
        }
      })()

      expect(RepoId.isRepoId(value)).toBe(parseAccepts)
    }
  })
})
