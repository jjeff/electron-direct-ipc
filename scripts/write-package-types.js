/**
 * Cross-platform script to write package.json type markers for ESM/CJS builds.
 * This replaces shell echo commands that don't work correctly on Windows.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const esmPackage = { type: 'module' }
const cjsPackage = { type: 'commonjs' }

const esmPath = join(rootDir, 'dist/esm/package.json')
const cjsPath = join(rootDir, 'dist/cjs/package.json')

// Ensure directories exist
mkdirSync(dirname(esmPath), { recursive: true })
mkdirSync(dirname(cjsPath), { recursive: true })

// Write package.json files with proper JSON formatting
writeFileSync(esmPath, JSON.stringify(esmPackage, null, 2) + '\n')
writeFileSync(cjsPath, JSON.stringify(cjsPackage, null, 2) + '\n')

console.log('Created dist/esm/package.json and dist/cjs/package.json')
