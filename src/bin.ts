#!/usr/bin/env node
import { inspectControlPlane } from './doctor.js'

const USAGE = `Usage: dsh-control-plane doctor [--dsh-home <absolute-path>] [--pretty]

Reads and validates the Control Plane database, lease state, Evidence manifest,
and Evidence envelopes. This command never creates, migrates, repairs, clears,
or deletes Control Plane state.`

function usageError(message: string): never {
  throw new TypeError(`${message}\n\n${USAGE}`)
}

function parseArguments(argv: readonly string[]): {
  readonly dshHome?: string
  readonly pretty: boolean
  readonly help: boolean
} {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`)
    return { pretty: false, help: true }
  }
  if (argv[0] !== 'doctor') usageError('The only supported command is doctor.')
  let dshHome: string | undefined
  let pretty = false
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--pretty') {
      pretty = true
      continue
    }
    if (argument === '--dsh-home') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) usageError('--dsh-home requires a path.')
      dshHome = value
      index += 1
      continue
    }
    usageError(`Unknown argument '${String(argument)}'.`)
  }
  return { ...dshHome === undefined ? {} : { dshHome }, pretty, help: false }
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2))
  if (parsed.help) return
  const report = await inspectControlPlane(parsed)
  process.stdout.write(`${JSON.stringify(report, null, parsed.pretty ? 2 : undefined)}\n`)
  process.exitCode = report.ok ? 0 : 1
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
})
