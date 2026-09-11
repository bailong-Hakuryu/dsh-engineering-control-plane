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
  peerDependencies?: Record<string, string>
}
const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const eriiDogfoodProfile = readFileSync(
  new URL('../profiles/erii-python.cordis.patch.example.yml', import.meta.url),
  'utf8',
)
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

function releaseSection(version: string): string {
  const heading = `## [${version}]`
  const start = changelog.indexOf(heading)
  if (start < 0) return ''
  const next = changelog.indexOf('\n## [', start + heading.length)
  return changelog.slice(start, next < 0 ? undefined : next)
}

describe('v0.1 release package', () => {
  it('is explicitly publishable under the reviewed license', () => {
    expect(packageJson.version).toBe('0.1.13')
    expect(packageJson.private).toBe(false)
    expect(packageJson.license).toBe('MIT')
    expect(packageJson.publishConfig?.access).toBe('public')
    expect(packageJson.files).toEqual(expect.arrayContaining([
      'assets/*.svg',
      'profiles/*.yml',
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

  it('ships a portable ERII dogfood profile without truncating verification scope', () => {
    expect(eriiDogfoodProfile).toContain('DSH_ERII_PYTHON')
    expect(eriiDogfoodProfile).toContain('DSH_ERII_TEMP_ROOT')
    expect(eriiDogfoodProfile).toContain('UV_CACHE_DIR')
    expect(eriiDogfoodProfile).toContain('process.platform === "win32"')
    expect(eriiDogfoodProfile).not.toContain('TMPDIR]')
    expect(eriiDogfoodProfile).toContain('name: pytest-deepseek-continuity-review')
    expect(eriiDogfoodProfile).toContain('experiments/deepseek-continuity-review/tests')
    expect(eriiDogfoodProfile).toMatch(
      /name: ruff[\s\S]*clients\/typescript\/scripts[\s\S]*experiments\/deepseek-continuity-review/u,
    )
    expect(eriiDogfoodProfile).toMatch(
      /name: compileall[\s\S]*clients\/typescript\/scripts[\s\S]*experiments\/deepseek-continuity-review/u,
    )
    expect(eriiDogfoodProfile).toContain('providerVersion: 0.1.0-rc.14')
    expect(eriiDogfoodProfile).not.toMatch(/[A-Z]:\\/u)
  })

  it('declares the exact Harness versions verified by the joint matrix', () => {
    const expectedRange = [
      '0.1.2-alpha.1',
      '0.1.2-alpha.2',
      '0.1.2-alpha.3',
      '0.1.2-alpha.4',
      '0.1.2-alpha.5',
      '0.1.2-rc.1',
      '0.1.3-alpha.1',
      '0.1.3-alpha.2',
      '0.1.5-alpha.1',
      '0.1.5-alpha.2',
      '0.1.5-rc.1',
      '0.1.5-rc.2',
    ].join(' || ')
    for (const name of [
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-commands',
      '@deepseek-ai/dsh-home-paths',
      '@deepseek-ai/dsh-invariants',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-subagent',
      '@deepseek-ai/dsh-subprocess',
      '@deepseek-ai/dsh-tools',
    ]) {
      expect(packageJson.peerDependencies?.[name]).toBe(expectedRange)
    }
  })

  it('cuts the current changelog without rewriting the published v0.1.11 boundary', () => {
    const current = releaseSection(packageJson.version)
    const published = releaseSection('0.1.11')

    expect(current).toContain('YAML-parser security hotfix')
    expect(current).toContain('0.1.0-rc.14')
    expect(published).toContain('ERII')
    expect(published).toContain('phase-aware')
    expect(published).toContain('0.1.0-rc.12')
    expect(published).toContain('0.1.5-rc.1')
    expect(published).not.toContain('0.1.5-rc.2')
  })
})
