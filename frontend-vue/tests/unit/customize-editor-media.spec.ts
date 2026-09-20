import { describe, expect, it, vi } from 'vitest'
import { ObjectUrlRegistry } from '@/features/customize-editor/object-url-registry'
import {
  averageHash,
  boundedFrameIndexes,
  hammingDistance,
  selectedByAdjacentHash
} from '@/features/customize-editor/media-processing'
import {
  MAX_SOURCE_BYTES,
  safeRemoteFrameUrl,
  validateSourceFiles,
  validateTrimWindow
} from '@/features/customize-editor/source-validation'

function file(name: string, type: string, bytes = 1): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

describe('customization media boundary', () => {
  it('accepts a strict image sequence, GIF and a supported single video', () => {
    const images = validateSourceFiles([
      file('001.jpg', 'image/jpeg'),
      file('002.webp', 'image/webp')
    ])
    expect(images.kind).toBe('image-sequence')
    expect(images.videoMime).toBeNull()

    const gif = validateSourceFiles([file('source.gif', 'image/gif')])
    expect(gif.kind).toBe('gif')
    expect(gif.videoMime).toBeNull()

    const video = validateSourceFiles([file('source.mp4', 'video/mp4')], () => true)
    expect(video.kind).toBe('video')
    expect(video.videoMime).toBe('video/mp4')
  })

  it('rejects mixed inputs, disguised files and unsupported codecs', () => {
    expect(() =>
      validateSourceFiles(
        [file('001.png', 'image/png'), file('source.mp4', 'video/mp4')],
        () => true
      )
    ).toThrow('不能与视频混合')
    expect(() => validateSourceFiles([file('fake.png', 'text/html')])).toThrow('视频素材只允许')
    expect(() => validateSourceFiles([file('source.gif', 'text/html')])).toThrow(
      '扩展名与内容类型不一致'
    )
    expect(() => validateSourceFiles([file('source.mov', 'video/quicktime')], () => false)).toThrow(
      '无法解码 MOV'
    )
  })

  it('enforces file count and aggregate size limits', () => {
    expect(() => validateSourceFiles([])).toThrow('请选择素材文件')
    expect(() =>
      validateSourceFiles(
        Array.from({ length: 51 }, (_, index) => file(`${index}.jpg`, 'image/jpeg'))
      )
    ).toThrow('最多选择 50 个文件')
    const oversized = file('large.mp4', 'video/mp4')
    Object.defineProperty(oversized, 'size', { value: MAX_SOURCE_BYTES + 1 })
    expect(() => validateSourceFiles([oversized], () => true)).toThrow('不能超过 200 MB')
  })

  it('validates the 0.5 to 8 second trim window', () => {
    expect(() => validateTrimWindow(1, 9, 12)).not.toThrow()
    expect(() => validateTrimWindow(1, 1.4, 12)).toThrow('0.5 至 8')
    expect(() => validateTrimWindow(1, 9.1, 12)).toThrow('0.5 至 8')
    expect(() => validateTrimWindow(-1, 2, 12)).toThrow('区间无效')
    expect(() => validateTrimWindow(2, 13, 12)).toThrow('区间无效')
  })

  it('only accepts absolute HTTP(S) frame URLs', () => {
    expect(safeRemoteFrameUrl('https://cdn.example.invalid/frame.jpg')).toBe(
      'https://cdn.example.invalid/frame.jpg'
    )
    expect(() => safeRemoteFrameUrl('/api/files/frame')).toThrow('不受信任')
    expect(() => safeRemoteFrameUrl('javascript:alert(1)')).toThrow('不受信任')
    expect(() => safeRemoteFrameUrl('data:image/png;base64,AA==')).toThrow('不受信任')
  })

  it('releases only owned object URLs and can release all on teardown', () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const registry = new ObjectUrlRegistry()

    expect(registry.create(new Blob())).toBe('blob:first')
    expect(registry.create(new Blob())).toBe('blob:second')
    registry.release('blob:first')
    registry.release('blob:foreign')
    registry.releaseAll()

    expect(create).toHaveBeenCalledTimes(2)
    expect(revoke.mock.calls).toEqual([['blob:first'], ['blob:second']])
    expect(registry.size).toBe(0)
  })

  it('computes deterministic average hashes and marks only adjacent duplicates', () => {
    const darkThenLight = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
    const inverse = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const first = averageHash(darkThenLight)
    const second = averageHash(inverse)

    expect([...first]).toEqual([0, 1])
    expect(hammingDistance(first, second)).toBe(2)
    expect(selectedByAdjacentHash([first, first, second], 0)).toEqual([true, false, true])
  })

  it('uniformly bounds the editable frame collection', () => {
    expect(boundedFrameIndexes(4, 4)).toEqual([0, 1, 2, 3])
    const indexes = boundedFrameIndexes(240, 150)
    expect(indexes).toHaveLength(150)
    expect(new Set(indexes).size).toBe(150)
    expect(indexes[0]).toBe(0)
    expect(indexes.at(-1)).toBeLessThan(240)
  })
})
