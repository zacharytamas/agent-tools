import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import type { CreateEntryAuthorityMode, Warning } from '@tools/slog'

type OpenCodeCreateAuthorityMode = Extract<
  CreateEntryAuthorityMode,
  'delegated' | 'discretionary'
>

export interface ProvenanceResolverInput {
  readonly agent: string
  readonly authorityMode?: CreateEntryAuthorityMode | undefined
  readonly resolveUser?:
    | (() => string | undefined | Promise<string | undefined>)
    | undefined
}

export interface ProvenanceResolverOutput {
  readonly actor: string
  readonly authoritySource: string
  readonly authorityMode: OpenCodeCreateAuthorityMode
  readonly warnings: ReadonlyArray<Warning>
}

export interface LocalUserResolverInput {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  readonly homeDir?: string | undefined
  readonly osUserInfo?: (() => { readonly username: string }) | undefined
  readonly readConfig?: ((path: string) => Promise<string>) | undefined
}

const authorityDowngradedWarning: Warning = {
  code: 'authority_downgraded',
  message:
    'Delegated authority requires a resolved human identity distinct from the OpenCode actor; downgraded to discretionary.',
}

export async function resolveProvenance({
  agent,
  authorityMode,
  resolveUser = resolveLocalUser,
}: ProvenanceResolverInput): Promise<ProvenanceResolverOutput> {
  const actor = `opencode:${agent}`

  if (authorityMode !== 'delegated') {
    return discretionaryProvenance(actor)
  }

  const user = normalizeIdentity(await resolveUser())
  if (user !== undefined && user !== actor) {
    return {
      actor,
      authorityMode: 'delegated',
      authoritySource: user,
      warnings: [],
    }
  }

  return {
    ...discretionaryProvenance(actor),
    warnings: [authorityDowngradedWarning],
  }
}

export async function resolveLocalUser({
  env = process.env,
  homeDir = homedir(),
  osUserInfo = userInfo,
  readConfig = readFileUtf8,
}: LocalUserResolverInput = {}): Promise<string | undefined> {
  try {
    const slogHome = resolve(env.SLOG_HOME ?? join(homeDir, '.slog'))
    const configPath = join(slogHome, 'config.toml')
    try {
      const text = await readConfig(configPath)
      const configUser = readUserFromConfig(text)
      if (configUser !== undefined) return configUser
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    }
    return osUserInfo().username
  } catch {
    return undefined
  }
}

function discretionaryProvenance(actor: string): ProvenanceResolverOutput {
  return {
    actor,
    authorityMode: 'discretionary',
    authoritySource: actor,
    warnings: [],
  }
}

function normalizeIdentity(identity: string | undefined): string | undefined {
  const normalized = identity?.trim()
  return normalized ? normalized : undefined
}

function readUserFromConfig(text: string): string | undefined {
  const parsed = Bun.TOML.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('user' in parsed)) {
    return undefined
  }
  const user = (parsed as { readonly user?: unknown }).user
  return typeof user === 'string' ? normalizeIdentity(user) : undefined
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, 'utf8')
}
