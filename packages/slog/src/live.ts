import { BunServices } from '@effect/platform-bun'
import { Layer } from 'effect'
import {
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveSlogConfigLayer,
} from './environment.js'
import { LivePartitionLockLayer } from './lock.js'
import { LiveEntryRepositoryLayer } from './storage.js'

const LiveRepositoryWithConfigLayer = LiveEntryRepositoryLayer.pipe(
  Layer.provideMerge(LivePartitionLockLayer),
  Layer.provideMerge(LiveSlogConfigLayer),
)

export const SlogLive = Layer.mergeAll(
  LiveSlogConfigLayer,
  LiveClockLayer,
  LiveIdGeneratorLayer,
  LiveMachineInputLayer,
  LiveRepositoryWithConfigLayer,
).pipe(Layer.provideMerge(BunServices.layer))
