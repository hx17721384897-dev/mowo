// routes/addresses.js — 用户收货地址簿 CRUD

const PHONE_RE = /^1[3-9]\d{9}$/

async function addressRoutes(fastify, opts) {
  const { prisma } = fastify

  // 所有接口统一检查设备会话和账号状态。
  fastify.addHook('preHandler', async (req, reply) => {
    return fastify.authenticate(req, reply)
  })

  /* ─────────────────── GET /api/addresses ─────────────────── */
  fastify.get('/', async (req, reply) => {
    const userId = req.user.userId
    const addresses = await prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    })
    return reply.send({ success: true, data: addresses })
  })

  /* ─────────────────── POST /api/addresses ────────────────── */
  fastify.post('/', async (req, reply) => {
    const userId = req.user.userId
    const { label, name, phone, province, city, district, detail, isDefault } = req.body || {}

    // 校验
    if (!name || name.trim().length < 1 || name.trim().length > 20)
      return reply.code(400).send({ success: false, message: '姓名需为1-20个字符' })
    if (!phone || !PHONE_RE.test(phone))
      return reply.code(400).send({ success: false, message: '请输入正确的手机号' })
    if (!province || !city || !district)
      return reply.code(400).send({ success: false, message: '请选择省市区' })
    if (!detail || detail.trim().length < 5)
      return reply.code(400).send({ success: false, message: '详细地址不少于5个字符' })

    // 限制20条
    const count = await prisma.userAddress.count({ where: { userId } })
    if (count >= 20)
      return reply.code(400).send({ success: false, message: '最多保存20个收货地址' })

    const wantDefault = isDefault === true || count === 0  // 第一条自动设为默认

    const address = await prisma.$transaction(async (tx) => {
      if (wantDefault) {
        // 清除其他默认
        await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } })
      }
      return tx.userAddress.create({
        data: {
          userId,
          label: label?.trim() || null,
          name: name.trim(),
          phone,
          province: province.trim(),
          city: city.trim(),
          district: district.trim(),
          detail: detail.trim(),
          isDefault: wantDefault
        }
      })
    })

    return reply.code(201).send({ success: true, data: address })
  })

  /* ─────────────────── PUT /api/addresses/:id ─────────────── */
  fastify.put('/:id', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params
    const { label, name, phone, province, city, district, detail, isDefault } = req.body || {}

    const existing = await prisma.userAddress.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId)
      return reply.code(404).send({ success: false, message: '地址不存在' })

    // 校验（仅校验传了的字段）
    if (name !== undefined && (name.trim().length < 1 || name.trim().length > 20))
      return reply.code(400).send({ success: false, message: '姓名需为1-20个字符' })
    if (phone !== undefined && !PHONE_RE.test(phone))
      return reply.code(400).send({ success: false, message: '请输入正确的手机号' })
    if (detail !== undefined && detail.trim().length < 5)
      return reply.code(400).send({ success: false, message: '详细地址不少于5个字符' })

    const address = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } })
      }
      return tx.userAddress.update({
        where: { id },
        data: {
          ...(label !== undefined && { label: label?.trim() || null }),
          ...(name !== undefined && { name: name.trim() }),
          ...(phone !== undefined && { phone }),
          ...(province !== undefined && { province: province.trim() }),
          ...(city !== undefined && { city: city.trim() }),
          ...(district !== undefined && { district: district.trim() }),
          ...(detail !== undefined && { detail: detail.trim() }),
          ...(isDefault === true && { isDefault: true })
        }
      })
    })

    return reply.send({ success: true, data: address })
  })

  /* ─────────────────── DELETE /api/addresses/:id ──────────── */
  fastify.delete('/:id', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const existing = await prisma.userAddress.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId)
      return reply.code(404).send({ success: false, message: '地址不存在' })

    await prisma.$transaction(async (tx) => {
      await tx.userAddress.delete({ where: { id } })
      // 若删除的是默认地址，自动将最新一条设为默认
      if (existing.isDefault) {
        const latest = await tx.userAddress.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' }
        })
        if (latest) {
          await tx.userAddress.update({ where: { id: latest.id }, data: { isDefault: true } })
        }
      }
    })

    return reply.send({ success: true, message: '已删除' })
  })

  /* ─────────────────── PUT /api/addresses/:id/default ──────── */
  fastify.put('/:id/default', async (req, reply) => {
    const userId = req.user.userId
    const { id } = req.params

    const existing = await prisma.userAddress.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId)
      return reply.code(404).send({ success: false, message: '地址不存在' })

    await prisma.$transaction(async (tx) => {
      await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } })
      await tx.userAddress.update({ where: { id }, data: { isDefault: true } })
    })

    return reply.send({ success: true, message: '已设为默认地址' })
  })
}

export default addressRoutes
