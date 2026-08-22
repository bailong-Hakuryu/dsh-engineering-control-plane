import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.js'

const PACKAGE_NAME = 'dsh-engineering-control-plane'

export const name = 'engineering-control-plane-invariant'
export const inject = ['invariants']

/** Fail startup diagnostics if durable validation/recovery did not complete. */
const install: InvariantInstaller = Object.assign(async (ctx: Context, fail: InvariantFailure) => {
  try {
    await ctx.engineeringControlPlane.whenReady()
  } catch (error) {
    fail(`service readiness failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}, { inject: ['engineeringControlPlane'] })

/** Register the package-owned runtime invariant through the Harness registry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
