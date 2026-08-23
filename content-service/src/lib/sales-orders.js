import crypto from 'crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(length = 8) {
  const bytes = crypto.randomBytes(length)
  return [...bytes].map(byte => ALPHABET[byte % ALPHABET.length]).join('')
}

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

export function createSalesOrderNo() {
  return `SO-${dayStamp()}-${randomCode(8)}`
}

export function createProductionUnitNo() {
  return `PU-${dayStamp()}-${randomCode(8)}`
}

export function createProductionBatchNo() {
  return `PB-${dayStamp()}-${randomCode(6)}`
}

export function createSalesOrderItemNo(orderNo, index) {
  return `${orderNo}-${String(index).padStart(2, '0')}`
}

export function summarizeProductionStatus(tasks = []) {
  const statuses = tasks.map(task => task.status)
  if (!statuses.length) return 'paid'
  if (statuses.every(status => status === 'cancelled')) return 'cancelled'
  if (statuses.some(status => status === 'aftersale')) return 'aftersale'
  if (statuses.every(status => status === 'received')) return 'received'
  if (statuses.every(status => ['shipped', 'received'].includes(status))) return 'shipped'
  if (statuses.some(status => ['locked', 'processing', 'producing', 'shipped', 'received'].includes(status))) return 'producing'
  return statuses.some(status => status === 'pending') ? 'pending' : 'paid'
}
