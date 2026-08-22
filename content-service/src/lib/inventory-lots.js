export async function listAvailableLots(prisma, material) {
  if (material.itemType === 'PACKED') {
    return prisma.materialPreparationBatch.findMany({
      where: { outputMaterialId: material.id, availableQty: { gt: 0 }, status: 'AVAILABLE', stockClass: 'NEW' },
      orderBy: [{ createdAt: 'asc' }, { batchNo: 'asc' }]
    }).then(rows => rows.map(row => ({
      id: row.id, batchNo: row.batchNo, sourceType: 'PREPARATION',
      availableQty: row.availableQty, location: row.location, createdAt: row.createdAt
    })))
  }

  return prisma.materialReceipt.findMany({
    where: { materialId: material.id, availableQty: { gt: 0 }, status: 'AVAILABLE', stockClass: 'NEW' },
    orderBy: [{ createdAt: 'asc' }, { receiptNo: 'asc' }]
  }).then(rows => rows.map(row => ({
    id: row.id, batchNo: row.receiptNo, sourceType: 'RECEIPT',
    availableQty: row.availableQty, location: row.location, createdAt: row.createdAt,
    supplierName: row.supplierName, supplierLotNo: row.supplierLotNo
  })))
}

export function allocateLots(lots, requiredQty, overrides) {
  const requested = Array.isArray(overrides) && overrides.length
    ? overrides.map(row => ({ sourceBatchId: row.sourceBatchId, quantity: Number(row.quantity) }))
    : null

  if (requested) {
    const lotMap = new Map(lots.map(lot => [lot.id, lot]))
    const allocations = []
    let total = 0
    for (const row of requested) {
      const lot = lotMap.get(row.sourceBatchId)
      if (!lot || !Number.isInteger(row.quantity) || row.quantity <= 0 || row.quantity > lot.availableQty) {
        throw new Error('手动选择的批次或数量无效，请刷新后重试')
      }
      total += row.quantity
      allocations.push({ ...lot, quantity: row.quantity })
    }
    if (total !== requiredQty) throw new Error(`所选批次数量合计必须为 ${requiredQty}`)
    return allocations
  }

  let remaining = requiredQty
  const allocations = []
  for (const lot of lots) {
    if (remaining <= 0) break
    const quantity = Math.min(remaining, lot.availableQty)
    allocations.push({ ...lot, quantity })
    remaining -= quantity
  }
  if (remaining > 0) throw new Error(`可用批次库存不足，还缺 ${remaining}`)
  return allocations
}

export async function previewMaterialAllocation(prisma, material, requiredQty, overrides) {
  const lots = await listAvailableLots(prisma, material)
  return allocateLots(lots, requiredQty, overrides)
}

export async function consumeMaterialAllocations(tx, material, allocations) {
  for (const allocation of allocations) {
    const model = allocation.sourceType === 'PREPARATION'
      ? tx.materialPreparationBatch
      : tx.materialReceipt
    const changed = await model.updateMany({
      where: { id: allocation.id, availableQty: { gte: allocation.quantity }, status: 'AVAILABLE' },
      data: { availableQty: { decrement: allocation.quantity } }
    })
    if (changed.count !== 1) throw new Error(`${material.name} 的批次 ${allocation.batchNo} 库存刚刚发生变化，请刷新后重试`)
    const updated = await model.findUnique({ where: { id: allocation.id } })
    if (updated.availableQty === 0) await model.update({ where: { id: allocation.id }, data: { status: 'EXHAUSTED' } })
  }
}

export function presentAllocation(material, allocations) {
  return {
    materialId: material.id,
    materialName: material.name,
    itemType: material.itemType,
    unit: material.unit,
    allocations: allocations.map(row => ({
      sourceBatchId: row.id,
      sourceType: row.sourceType,
      batchNo: row.batchNo,
      quantity: row.quantity,
      availableQty: row.availableQty,
      location: row.location,
      supplierName: row.supplierName,
      supplierLotNo: row.supplierLotNo,
      createdAt: row.createdAt
    }))
  }
}
