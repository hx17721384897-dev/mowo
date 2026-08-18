// Shared browser helper for registered private-file uploads.
(function () {
  function apiBase() {
    return location.hostname === '127.0.0.1'
      ? 'http://127.0.0.1:3001'
      : 'http://localhost:3001'
  }

  function extensionFor(mimeType) {
    return {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif'
    }[mimeType] || 'bin'
  }

  async function responseJson(response, fallback) {
    try {
      return await response.json()
    } catch {
      return { success: false, message: fallback }
    }
  }

  async function sourceToBlob(source) {
    if (typeof source !== 'string' || (!source.startsWith('data:') && !source.startsWith('blob:'))) {
      throw new Error('动画帧数据已失效，请返回上一步重新选择')
    }
    const response = await fetch(source)
    if (!response.ok) throw new Error('无法读取动画帧，请返回上一步重新选择')
    const blob = await response.blob()
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(blob.type)) {
      throw new Error('动画帧格式不受支持，请使用 JPG、PNG、WEBP 或 GIF')
    }
    return blob
  }

  async function uploadSources({ sources, token, purpose, onProgress }) {
    if (!token) throw new Error('请先登录后再上传')
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > 50) {
      throw new Error('一次需要上传 1 至 50 帧图片')
    }

    const keys = []
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]
      if (typeof source === 'string' && source.startsWith('private/')) {
        keys.push(source)
        onProgress?.(index + 1, sources.length)
        continue
      }

      const blob = await sourceToBlob(source)
      const fileName = `frame-${String(index + 1).padStart(3, '0')}.${extensionFor(blob.type)}`
      const createResponse = await fetch(`${apiBase()}/api/upload/presign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ purpose, fileName, fileType: blob.type, fileSize: blob.size })
      })
      const created = await responseJson(createResponse, '无法创建上传任务')
      if (!createResponse.ok || !created.success) throw new Error(created.message || '无法创建上传任务')

      const uploadResponse = await fetch(created.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob
      })
      if (!uploadResponse.ok) {
        const uploadError = await responseJson(uploadResponse, '动画帧上传失败')
        throw new Error(uploadError.message || '动画帧上传失败')
      }

      if (created.data.completeUrl) {
        const completeResponse = await fetch(created.data.completeUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` }
        })
        const completed = await responseJson(completeResponse, '动画帧校验失败')
        if (!completeResponse.ok || !completed.success) throw new Error(completed.message || '动画帧校验失败')
      }

      keys.push(created.data.objectKey)
      onProgress?.(index + 1, sources.length)
    }
    return keys
  }

  function tokenUserId(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      return payload.userId || payload.sub || null
    } catch {
      return null
    }
  }

  window.MowoPrivateUpload = { uploadSources, tokenUserId }
})()
