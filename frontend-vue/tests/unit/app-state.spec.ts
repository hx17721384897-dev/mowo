import { createApp } from 'vue'
import { describe, expect, it } from 'vitest'
import AppState from '@/components/AppState.vue'

describe('AppState', () => {
  it('renders a consistent accessible status', () => {
    const host = document.createElement('div')
    const app = createApp(AppState, { kind: 'empty', title: '没有数据', detail: '稍后再试' })

    app.mount(host)
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(host.textContent).toContain('没有数据')
    expect(host.textContent).toContain('稍后再试')
    app.unmount()
  })
})
