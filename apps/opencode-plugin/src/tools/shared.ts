import { SlogLive } from '@tools/slog'
import { Effect, type Layer } from 'effect'

export function runSlog<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(SlogLive as unknown as Layer.Layer<R, never, never>),
    ),
  )
}
