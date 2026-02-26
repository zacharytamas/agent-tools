import { Effect } from 'effect'

export class ShellService extends Effect.Service<ShellService>()(
  'ShellService',
  {
    effect: Effect.gen(function* () {
      return {}
    }),
  },
) {}
