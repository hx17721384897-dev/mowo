import crypto from 'crypto'
import AdmZip from 'adm-zip'
import { createCanvas, loadImage } from 'canvas'

const PROCESSOR_VERSION = 'FRAME_COMPOSE_V1'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
}

export function parseFrameSizeMm(size, fallbackWidth = null, fallbackHeight = null) {
  if (fallbackWidth && fallbackHeight) return { width: fallbackWidth, height: fallbackHeight }
  const values = String(size || '').replaceAll('×', 'x').replaceAll('*', 'x').match(/[\d.]+/g)?.map(Number) || []
  if (!values.length || values.some(value => !Number.isFinite(value) || value <= 0)) return null
  const width = Math.round(values[0] * 10)
  const height = Math.round((values[1] || values[0]) * 10)
  return { width, height }
}

export function inspectDocxTemplate(buffer) {
  const zip = new AdmZip(buffer)
  const document = zip.getEntry('word/document.xml')?.getData().toString('utf8')
  if (!document) throw new Error('Word 模板缺少 document.xml，文件可能已经损坏')
  if (zip.getEntries().some(entry => /vbaProject\.bin$/i.test(entry.entryName))) throw new Error('不允许上传带宏的 Word 模板')
  const cellCount = (document.match(/<w:tc(?:\s|>)/g) || []).length
  const tableCount = (document.match(/<w:tbl(?:\s|>)/g) || []).length
  if (!cellCount || !tableCount) throw new Error('Word 模板中没有可用于放置帧图的表格')
  return { cellCount, tableCount }
}

function drawCover(ctx, image, width, height, clipTop, clipHeight) {
  const scale = Math.max(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, clipTop, width, clipHeight)
  ctx.clip()
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  ctx.restore()
}

function markerColors(ctx, width, height) {
  const sampleWidth = Math.max(20, Math.round(width * 0.18))
  const sampleHeight = Math.max(20, Math.round(height * 0.16))
  const pixels = ctx.getImageData(width - sampleWidth, height - sampleHeight, sampleWidth, sampleHeight).data
  let luminance = 0
  for (let index = 0; index < pixels.length; index += 4) {
    luminance += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]
  }
  const average = luminance / (pixels.length / 4)
  return average < 140 ? { fill: '#ffffff', stroke: '#111111' } : { fill: '#111111', stroke: '#ffffff' }
}

async function composeFrame(currentBuffer, nextBuffer, config, number) {
  const [current, next] = await Promise.all([loadImage(currentBuffer), loadImage(nextBuffer)])
  const canvas = createCanvas(config.widthPx, config.heightPx)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const linePx = Math.max(1, Math.round(config.separatorMicrons / 25400 * config.dpi))
  const topHeight = Math.floor((config.heightPx - linePx) / 2)
  const bottomStart = topHeight + linePx
  drawCover(ctx, current, config.widthPx, config.heightPx, 0, topHeight)
  drawCover(ctx, next, config.widthPx, config.heightPx, bottomStart, config.heightPx - bottomStart)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, topHeight, config.widthPx, linePx)
  if (config.markerEnabled) {
    const fontSize = Math.max(12, Math.round(config.widthPx * 50 / 1080))
    const right = Math.max(3, Math.round(config.widthPx * 10 / 1080))
    const bottom = Math.max(4, Math.round(config.heightPx * 20 / 1080))
    const colors = markerColors(ctx, config.widthPx, config.heightPx)
    ctx.font = `700 ${fontSize}px Arial, sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.08))
    ctx.strokeStyle = colors.stroke
    ctx.fillStyle = colors.fill
    ctx.strokeText(String(number), config.widthPx - right, config.heightPx - bottom)
    ctx.fillText(String(number), config.widthPx - right, config.heightPx - bottom)
  }
  return canvas.toBuffer('image/png')
}

function drawingXml(relId, widthEmu, heightEmu, docPrId) {
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${docPrId}" name="Production frame ${docPrId}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="frame-${docPrId}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function ensureDrawingNamespaces(document) {
  const namespaces = {
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture'
  }
  return document.replace(/<w:document\b[^>]*>/, root => {
    let updated = root
    for (const [prefix, uri] of Object.entries(namespaces)) {
      if (!new RegExp(`\\sxmlns:${prefix}=`).test(updated)) {
        updated = updated.replace(/>$/, ` xmlns:${prefix}="${uri}">`)
      }
    }
    return updated
  })
}

export function buildProductionDocx(templateBuffer, renderedBuffers, targetFrameCount, group, requestedPages = null) {
  const zip = new AdmZip(templateBuffer)
  const documentEntry = zip.getEntry('word/document.xml')
  let document = ensureDrawingNamespaces(documentEntry.getData().toString('utf8'))
  const bodyMatch = document.match(/<w:body>([\s\S]*?)<\/w:body>/)
  if (!bodyMatch) throw new Error('无法读取 Word 模板正文')
  const sectionMatch = bodyMatch[1].match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)
  const section = sectionMatch?.[0] || ''
  const pageTemplate = bodyMatch[1].replace(section, '')
  const pages = targetFrameCount / group.framesPerSheet
  const selectedPages = Array.isArray(requestedPages) && requestedPages.length
    ? [...new Set(requestedPages.map(Number))].sort((a, b) => a - b)
    : Array.from({ length: pages }, (_, index) => index + 1)
  if (selectedPages.some(page => !Number.isInteger(page) || page < 1 || page > pages)) {
    throw new Error(`重印页码必须在 1-${pages} 页之间`)
  }
  const frameSize = parseFrameSizeMm(group.size, group.frameWidthMm, group.frameHeightMm)
  if (!frameSize) throw new Error('打印组没有有效的成品宽高')
  const widthEmu = Math.round(frameSize.width * 36000)
  const heightEmu = Math.round(frameSize.height * 36000)
  const relationships = []
  let imageNumber = 0
  const pageXml = []
  for (const pageNumber of selectedPages) {
    const page = pageNumber - 1
    let cellIndex = 0
    const filled = pageTemplate.replace(/<w:tc([\s\S]*?)<\/w:tc>/g, match => {
      if (cellIndex >= group.framesPerSheet) return match
      const absoluteIndex = page * group.framesPerSheet + cellIndex
      const buffer = renderedBuffers[absoluteIndex % renderedBuffers.length]
      imageNumber += 1
      const relId = `rIdMowoProduction${imageNumber}`
      const mediaName = `mowo-production-${imageNumber}.png`
      zip.addFile(`word/media/${mediaName}`, buffer)
      relationships.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/>`)
      const tcPr = match.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/)?.[0] || ''
      cellIndex += 1
      return `<w:tc>${tcPr}${drawingXml(relId, widthEmu, heightEmu, imageNumber)}</w:tc>`
    })
    if (cellIndex !== group.framesPerSheet) throw new Error(`模板可用单元格为 ${cellIndex} 个，与单页 ${group.framesPerSheet} 帧不一致`)
    pageXml.push(filled)
    if (pageNumber !== selectedPages.at(-1)) pageXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
  }
  document = document.replace(bodyMatch[0], `<w:body>${pageXml.join('')}${section}</w:body>`)
  zip.updateFile('word/document.xml', Buffer.from(document))
  const relPath = 'word/_rels/document.xml.rels'
  let rels = zip.getEntry(relPath)?.getData().toString('utf8')
  if (!rels) throw new Error('Word 模板缺少关系文件')
  rels = rels.replace('</Relationships>', `${relationships.join('')}</Relationships>`)
  zip.updateFile(relPath, Buffer.from(rels))
  const typesPath = '[Content_Types].xml'
  let types = zip.getEntry(typesPath)?.getData().toString('utf8')
  if (!/Extension="png"/i.test(types)) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
  zip.updateFile(typesPath, Buffer.from(types))
  return zip.toBuffer()
}

export async function ensureFrameRender(fastify, animationVersion, group, markerEnabled = true) {
  const sizeMm = parseFrameSizeMm(group.size, group.frameWidthMm, group.frameHeightMm)
  if (!sizeMm) throw new Error('打印组没有有效的成品宽高')
  const spec = {
    animationVersionId: animationVersion.id, size: group.size, dpi: group.renderDpi,
    separatorMicrons: group.separatorMicrons, markerEnabled, processorVersion: PROCESSOR_VERSION
  }
  const existing = await fastify.prisma.productionFrameRender.findUnique({
    where: { animationVersionId_size_dpi_separatorMicrons_markerEnabled_processorVersion: spec }
  })
  if (existing?.status === 'READY') return existing
  const sourceKeys = Array.isArray(animationVersion.frameKeys) ? animationVersion.frameKeys : []
  if (!sourceKeys.length) throw new Error('动画版本没有核心帧')
  const widthPx = Math.round(sizeMm.width / 25.4 * group.renderDpi)
  const heightPx = Math.round(sizeMm.height / 25.4 * group.renderDpi)
  const sourceBuffers = await Promise.all(sourceKeys.map(key => fastify.storageGetBuffer(key)))
  const frameBuffers = []
  const outputKeys = []
  const renderId = crypto.randomUUID()
  for (let index = 0; index < sourceBuffers.length; index++) {
    const output = await composeFrame(sourceBuffers[index], sourceBuffers[(index + 1) % sourceBuffers.length], {
      widthPx, heightPx, dpi: group.renderDpi, separatorMicrons: group.separatorMicrons, markerEnabled
    }, index + 1)
    const frameName = `frame-${String(index + 1).padStart(3, '0')}.png`
    const key = `generated/production-renders/${animationVersion.id}/${renderId}/${frameName}`
    await fastify.storagePut(key, output, { headers: { 'Content-Type': 'image/png' } })
    frameBuffers.push(output)
    outputKeys.push(key)
  }
  const manifestHash = sha256(JSON.stringify({ source: animationVersion.manifestHash, output: outputKeys.map((_, index) => sha256(frameBuffers[index])), spec, widthPx, heightPx }))
  return fastify.prisma.productionFrameRender.create({ data: {
    id: renderId, ...spec, widthPx, heightPx, frameKeys: outputKeys, manifestHash, status: 'READY'
  } })
}

export async function generateProductionFile(fastify, { assetId, animationVersionId, templateVersionId, targetFrameCount, markerEnabled = true, createdBy, sourceType = 'MANUAL', productionBatchId = null, requestedPages = null }) {
  const [asset, animationVersion, template] = await Promise.all([
    fastify.prisma.animationAsset.findUnique({ where: { id: assetId } }),
    fastify.prisma.animationAssetVersion.findUnique({ where: { id: animationVersionId } }),
    fastify.prisma.printTemplateVersion.findUnique({ where: { id: templateVersionId }, include: { group: true } })
  ])
  if (!asset || !animationVersion || animationVersion.assetId !== asset.id) throw new Error('动画资产版本不存在或不匹配')
  if (!template || template.status !== 'ACTIVE' || !template.group.isActive) throw new Error('打印模板不存在或已经停用')
  const target = Number(targetFrameCount)
  if (!Number.isInteger(target) || target <= 0) throw new Error('目标帧数无效')
  if (target % animationVersion.baseFrameCount !== 0) throw new Error(`目标帧数必须是核心 ${animationVersion.baseFrameCount} 帧的整数倍`)
  if (target % template.group.framesPerSheet !== 0) throw new Error(`目标帧数必须能被模板单页 ${template.group.framesPerSheet} 帧整除`)
  const render = await ensureFrameRender(fastify, animationVersion, template.group, markerEnabled)
  const renderedBuffers = await Promise.all(render.frameKeys.map(key => fastify.storageGetBuffer(key)))
  const templateBuffer = await fastify.storageGetBuffer(template.objectKey)
  const totalPages = target / template.group.framesPerSheet
  const selectedPages = Array.isArray(requestedPages) && requestedPages.length
    ? [...new Set(requestedPages.map(Number))].sort((a, b) => a - b)
    : null
  const output = buildProductionDocx(templateBuffer, renderedBuffers, target, template.group, selectedPages)
  const latest = await fastify.prisma.productionPrintFile.findFirst({
    where: { animationVersionId, templateVersionId, targetFrameCount: target }, orderBy: { fileVersionNo: 'desc' }
  })
  const fileVersionNo = (latest?.fileVersionNo || 0) + 1
  const safeAssetNo = asset.assetNo.replace(/[^a-zA-Z0-9_-]/g, '')
  const pageLabel = selectedPages ? ` · 重印第${selectedPages.join('、')}页` : ''
  const displayName = `${template.group.size} · ${target}帧 · ${template.group.paperSize}每页${template.group.framesPerSheet}帧${pageLabel} · V${fileVersionNo}.docx`
  const objectKey = `generated/production-files/${safeAssetNo}/${crypto.randomUUID()}.docx`
  await fastify.storagePut(objectKey, output, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })
  const manifestHash = sha256(Buffer.concat([output, Buffer.from(render.manifestHash), Buffer.from(template.sha256), Buffer.from(JSON.stringify({ selectedPages, totalPages }))]))
  return fastify.prisma.productionPrintFile.create({ data: {
    assetId, animationVersionId, renderId: render.id, templateVersionId, targetFrameCount: target,
    fileVersionNo, displayName, objectKey, manifestHash, sourceType, productionBatchId, createdBy, status: 'READY'
  } })
}
