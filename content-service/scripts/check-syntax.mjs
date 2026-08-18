import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'acorn'

const roots = ['src', 'prisma', 'scripts']
const sourceFiles = []

function collectFiles(path) {
  for (const name of readdirSync(path)) {
    const child = join(path, name)
    if (statSync(child).isDirectory()) {
      collectFiles(child)
    } else if (/\.(mjs|js)$/.test(name)) {
      sourceFiles.push(child)
    }
  }
}

for (const root of roots) collectFiles(root)
sourceFiles.sort()

for (const file of sourceFiles) {
  try {
    parse(readFileSync(file, 'utf8'), {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true
    })
  } catch (error) {
    process.stderr.write(`Syntax check failed for ${file}:\n${error.message}\n`)
    process.exit(1)
  }
}

console.log(`Syntax check passed for ${sourceFiles.length} JavaScript files`)
