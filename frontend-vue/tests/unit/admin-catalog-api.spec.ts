import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCatalogSku,
  deleteCatalogExampleImage,
  getCatalogBom,
  listCatalogModels,
  reorderCatalogModels,
  saveCatalogBom,
  saveCatalogModel,
  uploadCatalogSkuImage
} from '@/features/admin-catalog/api'

const apiRequest = vi.hoisted(() => vi.fn())
vi.mock('@/services/api-client', () => ({ apiRequest }))

describe('admin catalog API contract', () => {
  beforeEach(() => apiRequest.mockReset())

  it('loads model and SKU facts without creating a draft', async () => {
    apiRequest.mockResolvedValueOnce([{ id: 'model-1', name: '普通款' }])
    apiRequest.mockResolvedValueOnce([{ id: 'sku-1', modelId: 'model-1' }])
    await expect(listCatalogModels()).resolves.toMatchObject([
      { id: 'model-1', skus: [{ id: 'sku-1' }] }
    ])
    expect(apiRequest.mock.calls).toEqual([
      ['/api/machine-models/admin/all'],
      ['/api/machine-models/admin/model-1/skus']
    ])
  })

  it('keeps model, SKU, ordering and BOM mutations on their existing endpoints', async () => {
    apiRequest.mockResolvedValue({ success: true })
    await saveCatalogModel('model-1', {
      name: '普通款',
      description: '介绍',
      previewImage: null,
      videoUrl: null,
      modelType: 'single'
    })
    await createCatalogSku('model-1', {
      size: '5x5cm',
      material: '椴木板',
      frameCount: 12,
      colorName: '原色',
      colorHex: '#D4B896',
      price: 199
    })
    await reorderCatalogModels(['model-1'])
    await getCatalogBom('sku-1')
    await saveCatalogBom('sku-1', [{ materialId: 'material-1', qtyPerUnit: 2 }])
    expect(apiRequest.mock.calls.map((call) => call[0])).toEqual([
      '/api/machine-models/model-1',
      '/api/machine-models/model-1/skus',
      '/api/machine-models/reorder',
      '/api/machine-models/skus/sku-1/bom',
      '/api/machine-models/skus/sku-1/bom'
    ])
    expect(apiRequest.mock.calls[4]![1]).toMatchObject({
      method: 'PUT',
      body: { items: [{ materialId: 'material-1', qtyPerUnit: 2 }] }
    })
  })

  it('uses authenticated multipart transport and encoded object keys', async () => {
    apiRequest.mockResolvedValue({ exampleMedia: [] })
    await uploadCatalogSkuImage('sku-1', new File(['image'], 'cover.png', { type: 'image/png' }))
    await deleteCatalogExampleImage('sku-1', 'path/example.png')
    expect(apiRequest.mock.calls[0]![1].body).toBeInstanceOf(FormData)
    expect(apiRequest.mock.calls[1]).toEqual([
      '/api/machine-models/skus/sku-1/example-media',
      { method: 'DELETE', body: { objectKey: 'path/example.png' } }
    ])
  })
})
