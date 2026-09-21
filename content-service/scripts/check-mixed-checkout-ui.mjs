import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), '..')
const checkout = fs.readFileSync(path.join(root, 'frontend-vue', 'src', 'views', 'CheckoutView.vue'), 'utf8')
const cart = fs.readFileSync(path.join(root, 'frontend-vue', 'src', 'views', 'CartView.vue'), 'utf8')
const checkoutSession = fs.readFileSync(path.join(root, 'frontend-vue', 'src', 'features', 'transaction', 'checkout-session.ts'), 'utf8')
const cartRoute = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'cart.js'), 'utf8')
const paymentRoute = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'payment.js'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

assert(cart.includes("item.itemType === 'CUSTOM'") && cart.includes("'MARKET'"), '购物车同时呈现私人定制和联名商品')
assert(checkout.includes("item.itemType === 'CUSTOM' ? 'DIY 定制款' : '联名成品'"), '结算页能区分混合商品类型')
assert(checkout.includes('getOrCreateCheckoutAttempt') && checkoutSession.includes('checkout-${crypto.randomUUID()}'), '结算页为网络重试保留稳定防重编号')
assert(checkout.includes('提交订单') && !checkout.includes('立即支付'), 'Web 结算不再冒充已接入真实支付')
assert(checkout.includes('capabilities.mockPayment') && checkout.includes('getCheckoutCapabilities') && !checkout.includes("window.location.hostname === 'localhost'"), 'mock 付款入口只服从服务端隔离测试开关，不因本机访问自动展示')
assert(!checkout.includes('原则上不支持退款'), '结算页不展示未经确认的退款承诺')
assert(cartRoute.includes('checkoutSnapshot') && cartRoute.includes('reserveCheckoutInventory'), '服务端在同一结算流程冻结商品并预锁库存')
assert(paymentRoute.includes('readCheckoutSnapshot(preOrder.checkoutSnapshot)') && !paymentRoute.includes('tx.cartItem.findMany'), '付款落单只使用冻结快照，不回读可变购物车')
assert(paymentRoute.includes("await closePreOrderAndRelease(prisma, preOrder, 'expired')"), '付款状态轮询触发超时时通过统一事务释放预留库存')

console.log('Mixed checkout UI checks passed')
