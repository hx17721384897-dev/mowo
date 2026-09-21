export class CustomProductSelectionError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.name = 'CustomProductSelectionError'
    this.statusCode = statusCode
  }
}

function requestedSkuIds(request) {
  const options = Array.isArray(request?.editorData?.requestedOptions)
    ? request.editorData.requestedOptions
    : []
  return new Set([
    request?.desiredSkuId,
    ...options.map(item => item?.skuId),
  ].filter(value => typeof value === 'string' && value.length > 0))
}

// 定制确认页允许一份动画同时选择多款 SKU，因此 CustomProduct.hardwareSkuId
// 不能作为唯一购买授权。结算与加购统一回读已确认申请中的 SKU 白名单。
export async function resolveConfirmedCustomProductSelection(prisma, {
  userId,
  customProductId,
  sku,
}) {
  const product = await prisma.customProduct.findUnique({
    where: { id: customProductId },
    include: { animationVersion: true },
  })
  if (!product) {
    throw new CustomProductSelectionError('定制草稿不存在', 404)
  }
  if (product.userId !== userId) {
    throw new CustomProductSelectionError('无权操作此草稿', 403)
  }
  if (['ordered', 'removed'].includes(product.status)) {
    throw new CustomProductSelectionError('该草稿已提交，不可继续购买', 400)
  }

  const confirmedRequest = await prisma.customizationRequest.findFirst({
    where: {
      userId,
      customProductId: product.id,
      machineModelId: sku.modelId,
      status: 'CONFIRMED',
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, desiredSkuId: true, editorData: true },
  })
  if (!confirmedRequest || !requestedSkuIds(confirmedRequest).has(sku.id)) {
    throw new CustomProductSelectionError(
      '该定制款式尚未确认，请返回定制页面重新选择',
      409,
    )
  }
  if (product.frameCount && sku.frameCount && sku.frameCount % product.frameCount !== 0) {
    throw new CustomProductSelectionError(
      `当前动画为 ${product.frameCount} 帧，无法匹配 ${sku.frameCount} 帧底座（需整数倍才可循环补帧）`,
      400,
    )
  }

  return { product, confirmedRequest }
}
