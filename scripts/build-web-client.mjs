#!/usr/bin/env node
// Builds lib/client.js, the Harness Web client module for the Mission tool
// cards: the loader's lazy-CJS factory artifact
// (`window.__ModuleLoader__.load({ id, factory })`). Harness publishes no
// bundling preset for packages outside its repository, so each web-client
// module is transpiled to CommonJS with the project's TypeScript and linked
// through a private module table inside the factory. `react` is the only
// specifier left to the page's module table; any other import fails the build.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { argv, stdout } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const PACKAGE_ID = 'dsh-engineering-control-plane'
const PAGE_MODULES = new Set(['react'])
const MODULES = ['locales', 'model', 'card', 'index']
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(projectRoot, 'src', 'web-client')

async function transpile(moduleName) {
  const fileName = join(sourceRoot, `${moduleName}.ts`)
  const { outputText, diagnostics = [] } = ts.transpileModule(await readFile(fileName, 'utf8'), {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
      sourceMap: false,
    },
  })
  if (diagnostics.length > 0) {
    const messages = diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
    throw new Error(`web client ${moduleName}.ts failed to transpile:\n${messages.join('\n')}`)
  }
  for (const [, specifier] of outputText.matchAll(/require\("([^"]+)"\)/gu)) {
    const local = specifier.startsWith('./') && MODULES.includes(specifier.slice(2).replace(/\.js$/u, ''))
    if (!local && !PAGE_MODULES.has(specifier)) {
      throw new Error(`web client ${moduleName}.ts imports ${specifier}, which the page module table cannot provide`)
    }
  }
  return `__define(${JSON.stringify(`./${moduleName}.js`)}, function (require, module, exports) {\n${outputText}});`
}

/** Build the loader factory artifact; returns the written path. */
export async function buildWebClient({ outFile = join(projectRoot, 'lib', 'client.js') } = {}) {
  const modules = []
  for (const moduleName of MODULES) modules.push(await transpile(moduleName))
  const bundle = [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    'var __modules = {}; var __cache = {};',
    'function __define(id, body) { __modules[id] = body; }',
    'function __require(id) {',
    '  if (!Object.prototype.hasOwnProperty.call(__modules, id)) return require(id);',
    '  if (__cache[id] === undefined) {',
    '    __cache[id] = { exports: {} };',
    '    __modules[id](__require, __cache[id], __cache[id].exports);',
    '  }',
    '  return __cache[id].exports;',
    '}',
    ...modules,
    'module.exports = __require("./index.js");',
    'return module.exports; } });',
    '',
  ].join('\n')
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, bundle, 'utf8')
  return outFile
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(argv[1])).href) {
  stdout.write(`web client: ${await buildWebClient()}\n`)
}
