import { Prisma, PrismaClient } from '@prisma/client'

const url = new URL(process.env.DATABASE_URL || '')
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) ||
    !url.pathname.slice(1).startsWith('mowo_rehearsal_')) {
  throw new Error('This check may read only a local temporary mowo_rehearsal_ database')
}

const prisma = new PrismaClient()
const failed = []
let passed = 0
try {
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = prisma[model.name[0].toLowerCase() + model.name.slice(1)]
    if (typeof delegate?.findFirst !== 'function') {
      failed.push(`${model.name}: missing Prisma delegate`)
      continue
    }
    try {
      await delegate.findFirst()
      passed += 1
    } catch (error) {
      failed.push(`${model.name}: ${error.code || error.name || 'query error'}`)
    }
  }
  console.log(`Prisma full-column reads: ${passed}/${Prisma.dmmf.datamodel.models.length} models`)
  if (failed.length) {
    for (const item of failed) console.error(item)
    process.exitCode = 1
  }
} finally {
  await prisma.$disconnect()
}
