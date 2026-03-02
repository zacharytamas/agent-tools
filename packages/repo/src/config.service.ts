import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'

const REPO_DATA_PATH_ENV = 'AGENT_TOOLS_REPO_DATA_PATH'
const DEFAULT_REPO_DATA_PATH = join(homedir(), '.agent-tools', 'repo')

export class ConfigService extends Effect.Service<ConfigService>()(
  'ConfigService',
  {
    effect: Effect.sync(() => ({
      dataPath: process.env[REPO_DATA_PATH_ENV] ?? DEFAULT_REPO_DATA_PATH,
    })),
  },
) {}
