// prisma/seed.js
// 数据库种子文件 — 每次迁移后运行 `npx prisma db seed` 恢复测试数据
//
// 包含：
//   1. 测试账号（负责人 / 客服 / 普通用户 / 生产岗位）
//   2. 机型款式 + SKU（带库存）

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const demoSeedEnabled = process.env.ALLOW_DEMO_SEED === 'true'
const demoPassword = process.env.DEMO_SEED_PASSWORD || ''

function assertDemoSeedIsSafe() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed data is disabled in production')
  }
  if (!demoSeedEnabled) {
    throw new Error('Set ALLOW_DEMO_SEED=true before writing demo seed data')
  }
  const databaseName = new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, '')
  if (databaseName !== 'mowo_b1_test') {
    throw new Error('Demo seed is restricted to the isolated mowo_b1_test database')
  }
  if (demoPassword.length < 12 || demoPassword === '123456') {
    throw new Error('DEMO_SEED_PASSWORD must contain at least 12 characters and cannot use the old default')
  }
}

// ── 密码加密（与 src/lib/auth.js 保持一致）──
async function hashPassword(password) {
  return bcrypt.hash(password, 10)
}

async function main() {
  assertDemoSeedIsSafe()
  console.log('🌱 开始写入种子数据...')

  // ══════════════════════════════════════════
  // 1. 测试账号
  // ══════════════════════════════════════════
  const accounts = [
    {
      phone:         '17721384897',
      password:      demoPassword,
      nickname:      '哞屋负责人',
      role:          3,
      staffRole:     'OWNER',
    },
    {
      phone:         '13800138000',
      password:      demoPassword,
      nickname:      '负责人测试',
      role:          3,              // 旧字段兼容等级；授权以 staffRole 为准
      staffRole:     'OWNER',
    },
    {
      phone:         '13800138001',
      password:      demoPassword,
      nickname:      '客服测试',
      role:          2,              // 旧字段兼容等级；授权以 staffRole 为准
      staffRole:     'CUSTOMER_SERVICE',
    },
    {
      phone:         '13800138002',
      password:      demoPassword,
      nickname:      '普通用户小明',
      role:          0,
      staffRole:     null,
    },
    {
      phone:         '13800138003',
      password:      demoPassword,
      nickname:      '普通用户小红',
      role:          0,
      staffRole:     null,
    },
    {
      phone:         '13800138004',
      password:      demoPassword,
      nickname:      '生产端账号',
      role:          2,              // 后台兼容等级，具体权限由岗位决定
      staffRole:     'PRODUCTION',
    },
  ]

  for (const acc of accounts) {
    // upsert：已存在就跳过，不存在就创建
    const existing = await prisma.user.findUnique({ where: { phone: acc.phone } })
    if (existing) {
      console.log(`  ⏭  账号已存在，跳过：${acc.phone}（${acc.nickname}）`)
      continue
    }

    const passwordHash = await hashPassword(acc.password)

    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          phone:         acc.phone,
          passwordHash,
          role:          acc.role,
          staffRole:     acc.staffRole,
        }
      })

      await tx.userProfile.create({
        data: { userId: u.id, nickname: acc.nickname }
      })

      return u
    })

    console.log(`  ✅ 创建账号：${acc.phone}（${acc.nickname}）role=${acc.role}`)
  }

  // ══════════════════════════════════════════
  // 2. 机型款式 + SKU
  // ══════════════════════════════════════════
  const existingModel = await prisma.machineModel.findFirst({ where: { name: '标准款' } })

  if (existingModel) {
    console.log('  ⏭  机型数据已存在，跳过')
  } else {
    // 款式一：标准款
    const model1 = await prisma.machineModel.create({
      data: {
        name:        '标准款',
        description: '经典动画机，适合大多数帧图风格',
        ratios:      JSON.stringify(['1:1']),
        frameOptions: JSON.stringify([12, 16, 24]),
        sizes:       JSON.stringify(['5x5cm', '8x8cm']),
        sortOrder:   1,
        isActive:    true,
      }
    })

    const skus1 = [
      { size:'5x5cm', material:'椴木板', frameCount:12, colorName:'原色',   colorHex:'#D4B896', price:89  },
      { size:'5x5cm', material:'椴木板', frameCount:12, colorName:'胡桃色', colorHex:'#5C3D2E', price:89  },
      { size:'5x5cm', material:'亚克力', frameCount:12, colorName:'透明',   colorHex:'#E8F4F8', price:99  },
      { size:'8x8cm', material:'椴木板', frameCount:16, colorName:'原色',   colorHex:'#D4B896', price:129 },
      { size:'8x8cm', material:'椴木板', frameCount:24, colorName:'原色',   colorHex:'#D4B896', price:149 },
      { size:'8x8cm', material:'亚克力', frameCount:16, colorName:'透明',   colorHex:'#E8F4F8', price:139 },
    ]

    for (let i = 0; i < skus1.length; i++) {
      const sku = skus1[i]
      const created = await prisma.machineModelSku.create({
        data: {
          modelId:    model1.id,
          size:       sku.size,
          material:   sku.material,
          frameCount: sku.frameCount,
          colorName:  sku.colorName,
          colorHex:   sku.colorHex,
          price:      sku.price,
          isActive:   true,
          sortOrder:  i + 1,
          skuBarcode: `MOWO-SKU-${model1.id.slice(0,4).toUpperCase()}-${String(i+1).padStart(4,'0')}`,
        }
      })

      // 写入库存
      await prisma.skuInventory.create({
        data: {
          skuId:        created.id,
          currentStock: 50,
          reservedStock: 0,
          safetyStock:  10,
          maxOrderLimit: 100,
        }
      })
    }

    // 款式二：迷你款
    const model2 = await prisma.machineModel.create({
      data: {
        name:        '迷你款',
        description: '小巧精致，便于随身携带',
        ratios:      JSON.stringify(['1:1']),
        frameOptions: JSON.stringify([8, 12]),
        sizes:       JSON.stringify(['3x3cm', '4x4cm']),
        sortOrder:   2,
        isActive:    true,
      }
    })

    const skus2 = [
      { size:'3x3cm', material:'亚克力', frameCount:8,  colorName:'透明',   colorHex:'#E8F4F8', price:59 },
      { size:'4x4cm', material:'椴木板', frameCount:12, colorName:'原色',   colorHex:'#D4B896', price:79 },
    ]

    for (let i = 0; i < skus2.length; i++) {
      const sku = skus2[i]
      const created = await prisma.machineModelSku.create({
        data: {
          modelId:    model2.id,
          size:       sku.size,
          material:   sku.material,
          frameCount: sku.frameCount,
          colorName:  sku.colorName,
          colorHex:   sku.colorHex,
          price:      sku.price,
          isActive:   true,
          sortOrder:  i + 1,
          skuBarcode: `MOWO-SKU-${model2.id.slice(0,4).toUpperCase()}-${String(i+1).padStart(4,'0')}`,
        }
      })

      await prisma.skuInventory.create({
        data: {
          skuId:        created.id,
          currentStock: 30,
          reservedStock: 0,
          safetyStock:  5,
          maxOrderLimit: 50,
        }
      })
    }

    console.log('  ✅ 创建机型：标准款（6 个 SKU）+ 迷你款（2 个 SKU）')
  }

  // ══════════════════════════════════════════
  // 完成
  // ══════════════════════════════════════════
  console.log('')
  console.log('🎉 种子数据写入完成！')
  console.log('')
  console.log('  测试账号：17721384897、13800138000 至 13800138004')
  console.log('  密码来自 DEMO_SEED_PASSWORD，出于安全不会输出。')
}

main()
  .catch((e) => {
    console.error('❌ 种子数据写入失败：', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
