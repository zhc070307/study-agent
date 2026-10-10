// Resolve adopted source packages in a native app without shipping workspace symlinks.
import { registerHooks } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packages = new Map()
function scan(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    if (entry.name === 'node_modules' || entry.name === 'bin') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) scan(path)
    else if (entry.name === 'package.json') {
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      if (manifest.name?.startsWith('@deepseek-ai/')) packages.set(manifest.name, {directory, manifest})
    }
  }
}
scan(root)
function target(value, conditions) {
  if (typeof value === 'string') return value
  if (!value) return undefined
  for (const [condition, entry] of Object.entries(value)) {
    if (condition === 'default' || conditions.includes(condition)) {
      const found = target(entry, conditions)
      if (found) return found
    }
  }
}
registerHooks({resolve(specifier, context, next) {
  if (!specifier.startsWith('@deepseek-ai/')) return next(specifier, context)
  const parts = specifier.split('/')
  const name = parts.slice(0,2).join('/')
  const item = packages.get(name)
  if (!item) return next(specifier, context)
  const subpath = parts.length === 2 ? '.' : './'+parts.slice(2).join('/')
  const exports = item.manifest.exports ?? {'.':item.manifest.main ?? './src/index.ts'}
  let value = typeof exports === 'string' ? (subpath === '.' ? exports : undefined) : exports[subpath]
  if (!value && typeof exports === 'object') for (const [pattern, entry] of Object.entries(exports)) {
    if (!pattern.includes('*')) continue
    const [prefix, suffix] = pattern.split('*')
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const resolved = target(entry, context.conditions)
      value = resolved?.replace('*',subpath.slice(prefix.length, suffix ? -suffix.length : undefined))
      break
    }
  }
  const file = target(value, context.conditions)
  if (!file) throw new Error(`Package export unavailable: ${specifier}`)
  const path=join(item.directory,file)
  return next(context.conditions.includes('require') ? path : pathToFileURL(path).href, context)
}})
