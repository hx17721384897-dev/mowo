import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }))

vi.mock('@/services/api-client', () => ({
  apiRequest: apiRequestMock
}))

import { uploadRegisteredPrivateFile } from '@/services/private-upload'

function presign(overrides: Record<string, unknown> = {}) {
  return {
    fileId: 'file-1',
    uploadUrl: 'https://objects.example.invalid/signed-upload',
    objectKey: 'private/customization/source/file-1.mp4',
    completeUrl: '/api/upload/files/file-1/complete',
    purpose: 'CUSTOMIZATION_SOURCE',
    maxBytes: 1024,
    ...overrides
  }
}

describe('registered private upload', () => {
  beforeEach(() => {
    apiRequestMock.mockReset()
  })

  it('keeps site credentials off the object-storage PUT', async () => {
    apiRequestMock.mockResolvedValueOnce(presign()).mockResolvedValueOnce(undefined)
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    const source = new File([new Uint8Array([1])], 'source.mp4', { type: 'video/mp4' })

    await expect(
      uploadRegisteredPrivateFile(source, 'CUSTOMIZATION_SOURCE', {
        headers: { 'X-Upload-Session': 'session-1', Authorization: 'must-not-leak' }
      })
    ).resolves.toBe('private/customization/source/file-1.mp4')

    expect(apiRequestMock).toHaveBeenNthCalledWith(
      1,
      '/api/upload/presign',
      expect.objectContaining({
        headers: { 'X-Upload-Session': 'session-1', Authorization: 'must-not-leak' }
      })
    )
    const [, putOptions] = fetchMock.mock.calls[0]!
    expect(putOptions).toMatchObject({
      method: 'PUT',
      credentials: 'omit',
      headers: { 'Content-Type': 'video/mp4' }
    })
    expect((putOptions?.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      2,
      '/api/upload/files/file-1/complete',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('rejects a mismatched purpose before uploading', async () => {
    apiRequestMock.mockResolvedValueOnce(presign({ purpose: 'LIBRARY_FRAME' }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      uploadRegisteredPrivateFile(
        new File([new Uint8Array([1])], 'source.mp4', { type: 'video/mp4' }),
        'CUSTOMIZATION_SOURCE'
      )
    ).rejects.toThrow('上传信息不完整')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an untrusted completion origin before the storage PUT', async () => {
    apiRequestMock.mockResolvedValueOnce(
      presign({ completeUrl: 'https://attacker.example.invalid/api/upload/files/file-1/complete' })
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      uploadRegisteredPrivateFile(
        new File([new Uint8Array([1])], 'source.mp4', { type: 'video/mp4' }),
        'CUSTOMIZATION_SOURCE'
      )
    ).rejects.toThrow('确认地址不受信任')
    expect(apiRequestMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
