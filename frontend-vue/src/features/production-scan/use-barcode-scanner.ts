import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export type ScanHandler = (code: string) => Promise<void>

export function useBarcodeScanner(handler: Ref<ScanHandler>, onBusy: () => void): void {
  const processing = ref(false)
  let buffer = ''
  let timer: number | undefined

  const keydown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (target?.matches('input,textarea,select,[contenteditable="true"]')) return
    if (event.key === 'Enter') {
      if (!buffer) return
      event.preventDefault()
      const code = buffer
      buffer = ''
      window.clearTimeout(timer)
      if (processing.value) return onBusy()
      processing.value = true
      void handler.value(code).finally(() => (processing.value = false))
      return
    }
    if (event.key.length === 1) {
      buffer += event.key
      window.clearTimeout(timer)
      timer = window.setTimeout(() => (buffer = ''), 180)
    }
  }

  onMounted(() => document.addEventListener('keydown', keydown))
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', keydown)
    window.clearTimeout(timer)
  })
}
