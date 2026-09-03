import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string
  private: boolean
  license: string
  publishConfig?: { access?: string }
  files?: string[]
  scripts?: Record<string, string>
}
const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

describe('v0.1 release package', () => {
  it('is explicitly publishable under the reviewed license', () => {
    expect(packageJson.version).toBe('0.1.9')
    expect(packageJson.private).toBe(false)
    expect(packageJson.license).toBe('MIT')
    expect(packageJson.publishConfig?.access).toBe('public')
    expect(packageJson.files).toEqual(expect.arrayContaining([
      'assets/*.svg',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'SECURITY.md',
    ]))
  })

  it('rebuilds before packing and exposes one complete release gate', () => {
    expect(packageJson.scripts?.prepack).toBe('pnpm build')
    expect(packageJson.scripts?.['release:check']).toContain('pnpm lint')
    expect(packageJson.scripts?.['release:check']).toContain('pnpm pack:dry-run')
  })

  it('uses only tool names registered by the qualified Harness Web profile', () => {
    expect(bundlePatch).not.toMatch(/\blsp\b/u)
    expect(bundlePatch).not.toContain('str_replace_editor')
    expect(bundlePatch).toContain('allowTools: [read, glob, grep]')
    expect(bundlePatch).toContain('allowTools: [read, write, edit, glob, grep]')
  })
})
