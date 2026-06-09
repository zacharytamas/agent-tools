import { expect, test } from 'bun:test'
import type { MachineWarning, Warning } from '../src/core.js'

test('Warning aliases MachineWarning for assignability', () => {
  const machineWarning: MachineWarning = {
    code: 'warn_code',
    message: 'warn message',
  }
  const warning: Warning = machineWarning
  const machineWarningAgain: MachineWarning = warning

  expect(machineWarningAgain).toEqual(machineWarning)
})
