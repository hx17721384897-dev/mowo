import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useDecorativeCursor(interactiveSelector: string) {
  const cursorDot = ref<HTMLElement | null>(null)
  const cursorRing = ref<HTMLElement | null>(null)
  let animationFrame = 0
  let cleanup: (() => void) | null = null

  onMounted(() => {
    if (!window.matchMedia('(pointer:fine)').matches || !cursorDot.value || !cursorRing.value) {
      return
    }
    let mouseX = 0
    let mouseY = 0
    let ringX = 0
    let ringY = 0
    const move = (event: MouseEvent) => {
      mouseX = event.clientX
      mouseY = event.clientY
      if (cursorDot.value) {
        cursorDot.value.style.left = `${mouseX}px`
        cursorDot.value.style.top = `${mouseY}px`
      }
    }
    const hover = (event: MouseEvent) => {
      const target = event.target as Element | null
      cursorRing.value?.classList.toggle('is-active', Boolean(target?.closest(interactiveSelector)))
    }
    const tick = () => {
      ringX += (mouseX - ringX) * 0.12
      ringY += (mouseY - ringY) * 0.12
      if (cursorRing.value) {
        cursorRing.value.style.left = `${ringX}px`
        cursorRing.value.style.top = `${ringY}px`
      }
      animationFrame = window.requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseover', hover)
    animationFrame = window.requestAnimationFrame(tick)
    cleanup = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseover', hover)
    }
  })

  onBeforeUnmount(() => {
    cleanup?.()
    window.cancelAnimationFrame(animationFrame)
  })

  return { cursorDot, cursorRing }
}
