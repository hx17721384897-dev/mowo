export async function loadPrintCutConfig(prisma, { activeOnly = true } = {}) {
  return prisma.printCutGroup.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: {
      templates: { orderBy: { versionNo: 'desc' } },
      rules: {
        where: activeOnly ? { isActive: true, skuId: { not: null } } : { skuId: { not: null } },
        include: {
          sku: {
            include: { model: { select: { id: true, name: true, previewImage: true, isActive: true, sortOrder: true } } }
          }
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
      }
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
  })
}

export function buildPrintRuleMap(groups) {
  const map = new Map()
  for (const group of groups) {
    for (const rule of group.rules || []) {
      map.set(rule.skuId, { group, rule })
    }
  }
  return map
}

export function snapshotPrintRule(entry) {
  if (!entry) return null
  const { group, rule } = entry
  return {
    groupId: group.id,
    groupCode: group.code,
    groupName: group.name,
    groupOrder: group.sortOrder,
    skuId: rule.skuId,
    skuCode: rule.sku?.skuCode || null,
    modelId: rule.sku?.modelId || null,
    modelName: rule.sku?.model?.name || null,
    size: rule.sku?.size || group.size,
    frameCount: rule.sku?.frameCount || null,
    material: rule.sku?.material || null,
    colorName: rule.sku?.colorName || null,
    framesPerSheet: group.framesPerSheet,
    pagesPerUnit: rule.pagesPerUnit,
    ruleOrder: rule.sortOrder,
    paperSize: group.paperSize,
    paperType: group.paperType,
    orientation: group.orientation,
    frameWidthMm: group.frameWidthMm,
    frameHeightMm: group.frameHeightMm,
    renderDpi: group.renderDpi,
    separatorMicrons: group.separatorMicrons,
    cuttingTool: group.cuttingTool,
    templateKey: group.templateKey
  }
}

export function snapshotUnconfiguredSku(task) {
  return {
    groupId: null,
    groupCode: null,
    groupName: '未配置 SKU，待现场确认',
    groupOrder: Number.MAX_SAFE_INTEGER,
    skuId: task.skuId || null,
    skuCode: task.item?.skuCode || null,
    modelId: task.modelId || null,
    modelName: task.modelName || null,
    size: task.size || null,
    frameCount: task.frameCount || null,
    material: task.material || null,
    colorName: task.colorName || null,
    framesPerSheet: null,
    pagesPerUnit: null,
    ruleOrder: Number.MAX_SAFE_INTEGER,
    paperSize: null,
    cuttingTool: null,
    templateKey: null,
    unconfigured: true
  }
}
