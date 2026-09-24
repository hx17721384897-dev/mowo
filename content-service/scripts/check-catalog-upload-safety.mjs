import assert from 'node:assert/strict'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import machineModelRoutes from '../src/routes/machine-models.js'

const app = Fastify({ logger: false })
let putCount = 0
let deleteCount = 0
let updateCount = 0

app.decorate('jwt', {
  decode: () => ({ role: 2 }),
  verify: () => ({ role: 2 })
})
app.decorate('prisma', {
  machineModelSku: {
    findUnique: async () => ({
      id: 'sku-1',
      exampleMedia: JSON.stringify(['sku-example/sku-1/owned.png'])
    }),
    update: async ({ data }) => {
      updateCount += 1
      return { id: 'sku-1', ...data }
    }
  }
})
app.decorate('oss', {
  put: async () => {
    putCount += 1
  },
  delete: async () => {
    deleteCount += 1
  }
})
app.decorate('ossPresignGet', () => 'https://signed.example.test/image')
app.decorate('storagePublicUrl', () => null)
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
await app.register(machineModelRoutes, { prefix: '/api/machine-models' })

function multipartImage(content, type = 'image/png') {
  const boundary = '----mowo-catalog-safety'
  return {
    boundary,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="catalog.png"\r\nContent-Type: ${type}\r\n\r\n`
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  }
}

const fake = multipartImage(Buffer.from('<script>alert(1)</script>'))
const fakeResponse = await app.inject({
  method: 'POST',
  url: '/api/machine-models/skus/sku-1/upload-image',
  headers: {
    authorization: 'Bearer test',
    'content-type': `multipart/form-data; boundary=${fake.boundary}`
  },
  payload: fake.payload
})
assert.equal(fakeResponse.statusCode, 400)
assert.match(fakeResponse.json().message, /不是支持的图片格式/)
assert.equal(putCount, 0)
assert.equal(updateCount, 0)

const png = multipartImage(
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
)
const pngResponse = await app.inject({
  method: 'POST',
  url: '/api/machine-models/skus/sku-1/upload-image',
  headers: {
    authorization: 'Bearer test',
    'content-type': `multipart/form-data; boundary=${png.boundary}`
  },
  payload: png.payload
})
assert.equal(pngResponse.statusCode, 200)
assert.equal(putCount, 1)
assert.equal(updateCount, 1)

const foreignDelete = await app.inject({
  method: 'DELETE',
  url: '/api/machine-models/skus/sku-1/example-media',
  headers: { authorization: 'Bearer test' },
  payload: { objectKey: 'private/another-owner/secret.png' }
})
assert.equal(foreignDelete.statusCode, 403)
assert.equal(deleteCount, 0)
assert.equal(updateCount, 1)

await app.close()
console.log('PASS catalog uploads validate file bytes')
console.log('PASS example deletion rejects foreign object keys')
