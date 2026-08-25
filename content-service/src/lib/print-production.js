export function printSpecKey(size, frameCount) {
  return `${String(size || '').trim()}::${Number(frameCount || 0)}`
}

export async function loadPrintCutConfig(prisma, { activeOnly = true } = {}) {
  return prisma.printCutGroup.findMany({
    where: activeOnly ? { isActive: true } : {},
    include: {
      rules: {
        where: activeOnly ? { isActive: true } : {},
        orderBy: [{ sortOrder: 'asc' }, { frameCount: 'asc' }]
      }
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
  })
}

export function buildPrintRuleMap(groups) {
  const map = new Map()
  for (const group of groups) {
    for (const rule of group.rules || []) {
      map.set(printSpecKey(rule.size, rule.frameCount), { group, rule })
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
    size: rule.size,
    frameCount: rule.frameCount,
    framesPerSheet: group.framesPerSheet,
    pagesPerUnit: rule.pagesPerUnit,
    ruleOrder: rule.sortOrder,
    paperSize: group.paperSize,
    cuttingTool: group.cuttingTool,
    templateKey: group.templateKey
  }
}
