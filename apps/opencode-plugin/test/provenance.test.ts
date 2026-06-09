import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ProvenanceResolverOutput,
  resolveLocalUser,
  resolveProvenance,
} from '../src/provenance.js'

const expectedEmptyWarnings: ProvenanceResolverOutput['warnings'] = []

describe('OpenCode slog provenance resolver', () => {
  test('keeps delegated authority when local human identity is resolvable and distinct from actor', async () => {
    const provenance = await resolveProvenance({
      agent: 'build',
      authorityMode: 'delegated',
      resolveUser: () => 'zachary',
    })

    expect(provenance).toEqual({
      actor: 'opencode:build',
      authorityMode: 'delegated',
      authoritySource: 'zachary',
      warnings: expectedEmptyWarnings,
    })
  })

  test('defaults omitted authority mode to discretionary actor authority', async () => {
    const provenance = await resolveProvenance({ agent: 'build' })

    expect(provenance).toEqual({
      actor: 'opencode:build',
      authorityMode: 'discretionary',
      authoritySource: 'opencode:build',
      warnings: expectedEmptyWarnings,
    })
  })

  test('treats non-delegated authority mode as discretionary actor authority', async () => {
    const provenance = await resolveProvenance({
      agent: 'build',
      authorityMode: 'observed',
      resolveUser: () => 'zachary',
    })

    expect(provenance).toEqual({
      actor: 'opencode:build',
      authorityMode: 'discretionary',
      authoritySource: 'opencode:build',
      warnings: expectedEmptyWarnings,
    })
  })

  test('downgrades delegated authority with missing identity to discretionary plus warning', async () => {
    const provenance = await resolveProvenance({
      agent: 'build',
      authorityMode: 'delegated',
      resolveUser: () => undefined,
    })

    expect(provenance.actor).toBe('opencode:build')
    expect(provenance.authorityMode).toBe('discretionary')
    expect(provenance.authoritySource).toBe('opencode:build')
    expect(provenance.warnings).toEqual([
      {
        code: 'authority_downgraded',
        message:
          'Delegated authority requires a resolved human identity distinct from the OpenCode actor; downgraded to discretionary.',
      },
    ])
  })

  test('downgrades delegated authority with empty identity to discretionary plus warning', async () => {
    const provenance = await resolveProvenance({
      agent: 'build',
      authorityMode: 'delegated',
      resolveUser: () => '   ',
    })

    expect(provenance.authorityMode).toBe('discretionary')
    expect(provenance.authoritySource).toBe('opencode:build')
    expect(provenance.warnings.map((warning) => warning.code)).toEqual([
      'authority_downgraded',
    ])
  })

  test('downgrades delegated authority with actor-equal identity to discretionary plus warning', async () => {
    const provenance = await resolveProvenance({
      agent: 'build',
      authorityMode: 'delegated',
      resolveUser: () => 'opencode:build',
    })

    expect(provenance.authorityMode).toBe('discretionary')
    expect(provenance.authoritySource).toBe('opencode:build')
    expect(provenance.warnings.map((warning) => warning.code)).toEqual([
      'authority_downgraded',
    ])
  })

  test('awaits asynchronous identity resolution for delegated authority', async () => {
    const provenance = await resolveProvenance({
      agent: 'build',
      authorityMode: 'delegated',
      resolveUser: async () => 'zachary',
    })

    expect(provenance.authorityMode).toBe('delegated')
    expect(provenance.authoritySource).toBe('zachary')
    expect(provenance.warnings).toEqual([])
  })
})

describe('OpenCode slog local identity resolver', () => {
  test('reads configured user from SLOG_HOME config.toml', async () => {
    const slogHome = await mkdtemp(join(tmpdir(), 'slog-user-config-'))
    await writeFile(join(slogHome, 'config.toml'), 'user = "zachary"\n')

    const user = await resolveLocalUser({
      env: { SLOG_HOME: slogHome },
      osUserInfo: () => ({ username: 'os-user' }),
    })

    expect(user).toBe('zachary')
  })

  test('falls back to OS username when config.toml exists but has no usable user', async () => {
    const slogHome = await mkdtemp(join(tmpdir(), 'slog-user-no-valid-user-'))
    await writeFile(
      join(slogHome, 'config.toml'),
      '[settings]\ntheme = "dark"\n',
    )

    const user = await resolveLocalUser({
      env: { SLOG_HOME: slogHome },
      osUserInfo: () => ({ username: 'os-user' }),
    })

    expect(user).toBe('os-user')
  })

  test('falls back to OS username when config.toml is missing', async () => {
    const slogHome = await mkdtemp(join(tmpdir(), 'slog-user-fallback-'))

    const user = await resolveLocalUser({
      env: { SLOG_HOME: slogHome },
      osUserInfo: () => ({ username: 'os-user' }),
    })

    expect(user).toBe('os-user')
  })

  test('treats OS userInfo failure as unresolvable when config.toml is missing', async () => {
    const slogHome = await mkdtemp(join(tmpdir(), 'slog-user-throws-'))

    const user = await resolveLocalUser({
      env: { SLOG_HOME: slogHome },
      osUserInfo: () => {
        throw new Error('no username for you')
      },
    })

    expect(user).toBeUndefined()
  })
})
