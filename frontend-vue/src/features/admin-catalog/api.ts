import { apiRequest } from '@/services/api-client'

export interface CatalogSku {
  id: string
  modelId: string
  size: string
  material: string
  frameCount: number
  colorName: string
  colorHex: string
  previewImage: string | null
  price: number | string
  isActive: boolean
  sortOrder: number
  exampleMedia: string | null
}

export interface CatalogModel {
  id: string
  name: string
  description: string | null
  previewImage: string | null
  videoUrl: string | null
  modelType: 'single' | 'dual' | 'panorama'
  isActive: boolean
  sortOrder: number
  skus: CatalogSku[]
}

export interface CatalogInventory {
  skuId: string
  currentStock: number
  reservedStock: number
  isOut: boolean
  isLow: boolean
}

export interface CatalogMaterial {
  id: string
  name: string
  itemCode: string | null
  specification: string | null
  itemType: string
  currentStock: number
  unit: string
}

export interface CatalogBomItem {
  materialId: string
  qtyPerUnit: number
}

export interface CatalogBom {
  skuId: string
  version: number
  items: CatalogBomItem[]
}

export interface ModelInput {
  name: string
  description: string
  previewImage: string | null
  videoUrl: string | null
  modelType: CatalogModel['modelType']
}

export interface SkuInput {
  size: string
  material: string
  frameCount: number
  colorName: string
  colorHex: string
  price: number
}

const base = '/api/machine-models'
const modelPath = (id: string) => `${base}/${encodeURIComponent(id)}`
const skuPath = (id: string) => `${base}/skus/${encodeURIComponent(id)}`

export async function listCatalogModels(): Promise<CatalogModel[]> {
  const models = await apiRequest<Omit<CatalogModel, 'skus'>[]>(`${base}/admin/all`)
  const skus = await Promise.all(
    models.map((model) =>
      apiRequest<CatalogSku[]>(`${base}/admin/${encodeURIComponent(model.id)}/skus`)
    )
  )
  return models.map((model, index) => ({ ...model, skus: skus[index] || [] }))
}

export function listCatalogInventory(): Promise<CatalogInventory[]> {
  return apiRequest('/api/inventory')
}

export function saveCatalogModel(id: string | null, input: ModelInput): Promise<CatalogModel> {
  return apiRequest(id ? modelPath(id) : base, {
    method: id ? 'PUT' : 'POST',
    body: { ...input }
  })
}

export async function setCatalogModelActive(id: string, isActive: boolean): Promise<void> {
  await apiRequest(modelPath(id), { method: 'PUT', body: { isActive } })
}

export async function deleteCatalogModel(id: string): Promise<void> {
  await apiRequest(modelPath(id), { method: 'DELETE' })
}

export async function reorderCatalogModels(modelIds: string[]): Promise<void> {
  await apiRequest(`${base}/reorder`, { method: 'PUT', body: { modelIds } })
}

export function createCatalogSku(modelId: string, input: SkuInput): Promise<CatalogSku> {
  return apiRequest(`${modelPath(modelId)}/skus`, { method: 'POST', body: { ...input } })
}

export async function setCatalogSkuActive(id: string, isActive: boolean): Promise<void> {
  await apiRequest(skuPath(id), { method: 'PUT', body: { isActive } })
}

export async function setCatalogSkuPrice(id: string, price: number): Promise<void> {
  await apiRequest(`${skuPath(id)}/price`, { method: 'PUT', body: { price } })
}

export async function deleteCatalogSku(id: string): Promise<void> {
  await apiRequest(skuPath(id), { method: 'DELETE' })
}

export async function reorderCatalogSkus(modelId: string, skuIds: string[]): Promise<void> {
  await apiRequest(`${modelPath(modelId)}/skus/reorder`, { method: 'PUT', body: { skuIds } })
}

export function getCatalogSkuImageUrl(id: string): Promise<{ previewUrl: string | null }> {
  return apiRequest(`${skuPath(id)}/image-url`)
}

export function uploadCatalogSkuImage(
  id: string,
  file: File
): Promise<{ previewImage: string; previewUrl: string }> {
  const body = new FormData()
  body.append('file', file, file.name)
  return apiRequest(`${skuPath(id)}/upload-image`, { method: 'POST', body })
}

export function getCatalogExampleImageUrl(id: string, key: string): Promise<{ url: string }> {
  return apiRequest(`${skuPath(id)}/example-media-url?key=${encodeURIComponent(key)}`)
}

export function uploadCatalogExampleImage(
  id: string,
  file: File
): Promise<{ exampleMedia: string[] }> {
  const body = new FormData()
  body.append('file', file, file.name)
  return apiRequest(`${skuPath(id)}/example-media`, { method: 'POST', body })
}

export function deleteCatalogExampleImage(
  id: string,
  objectKey: string
): Promise<{ exampleMedia: string[] }> {
  return apiRequest(`${skuPath(id)}/example-media`, { method: 'DELETE', body: { objectKey } })
}

export function listCatalogMaterials(): Promise<CatalogMaterial[]> {
  return apiRequest('/api/materials')
}

export function getCatalogBom(id: string): Promise<CatalogBom> {
  return apiRequest(`${skuPath(id)}/bom`)
}

export function saveCatalogBom(id: string, items: CatalogBomItem[]): Promise<CatalogBom> {
  return apiRequest(`${skuPath(id)}/bom`, { method: 'PUT', body: { items } })
}
