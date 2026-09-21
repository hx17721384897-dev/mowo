import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.split('=')
  return [key.replace(/^--/, ''), rest.join('=')]
}))

const root = resolve(args.root || 'frontend')
const mount = `/${String(args.mount || 'mowo/frontend').replace(/^\/+|\/+$/g, '')}`
const port = Number(args.port || 5500)
const host = args.host || '127.0.0.1'
const appBase = String(args['app-base'] || `http://${host}:4173/app`).replace(/\/+$/, '')
const legacyVueRedirects = new Map([
  ['pages/settings.html', { pathname: `${appBase}/account/settings`, hash: '' }],
  ['pages/my-addresses.html', { pathname: `${appBase}/account/settings`, hash: '#addresses' }],
  ['pages/customize-confirm.html', { pathname: `${appBase}/customize/confirm`, hash: '' }]
])

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${host}`)
  const pathname = decodeURIComponent(requestUrl.pathname)
  if (pathname !== mount && !pathname.startsWith(`${mount}/`)) {
    response.writeHead(404).end('Not found')
    return
  }

  const relative = pathname.slice(mount.length).replace(/^\/+/, '') || 'pages/index.html'
  const redirect = legacyVueRedirects.get(relative)
  if (redirect) {
    response
      .writeHead(302, {
        Location: `${redirect.pathname}${requestUrl.search}${redirect.hash}`,
        'Cache-Control': 'no-store'
      })
      .end()
    return
  }
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404).end('Not found')
    return
  }

  response.writeHead(200, {
    'Content-Type': mime[extname(target).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  createReadStream(target).pipe(response)
}).listen(port, host, () => {
  console.log(`MOWO frontend: http://${host}:${port}${mount}/pages/index.html`)
})
