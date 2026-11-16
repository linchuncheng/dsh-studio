// 交付物里的截图：只读、只认图片、只认白名单目录下的文件，读成 data URL 交给前端。
// 不直接把磁盘路径暴露成静态资源：那样等于给整个文件系统开了个只读通道。
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

/** 允许读取的根目录：默认 ~/.dsh/dsh-studio-artifacts，可用环境变量改。 */
export function artifactsRoot() {
  const fromEnv = String(process.env.STUDIO_ARTIFACTS_ROOT ?? '').trim()
  return fromEnv === '' ? join(homedir(), '.dsh', 'dsh-studio-artifacts') : fromEnv
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

/**
 * 把交付物的 ref 读成 data URL。
 * 返回 { ok:true, mime, dataUrl, bytes } 或 { ok:false, error }（错误信息给人看）。
 */
export async function readArtifactImage(ref, root = artifactsRoot()) {
  const raw = String(ref ?? '').trim()
  if (raw === '') return { ok: false, error: '这条交付物没有文件路径（ref）' }
  const ext = extname(raw).toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(ext)) return { ok: false, error: '只支持 png / jpg / webp / gif 截图，当前是 ' + (ext === '' ? '（无扩展名）' : ext) }
  const base = resolve(root)
  const target = resolve(raw.startsWith('/') || /^[a-z]:/i.test(raw) ? raw : join(base, raw))
  let real = ''
  try { real = await realpath(target) } catch { return { ok: false, error: '找不到文件：' + target } }
  if (real !== base && !real.startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) {
    return { ok: false, error: '截图必须放在 ' + base + ' 目录下（当前是 ' + real + '）' }
  }
  const info = await stat(real).catch(() => null)
  if (info === null || !info.isFile()) return { ok: false, error: '不是文件：' + real }
  if (info.size > MAX_IMAGE_BYTES) return { ok: false, error: '图片太大（' + Math.round(info.size / 1024) + 'KB，上限 ' + Math.round(MAX_IMAGE_BYTES / 1024) + 'KB）' }
  const buffer = await readFile(real)
  return { ok: true, mime: MIME[ext], bytes: info.size, dataUrl: 'data:' + MIME[ext] + ';base64,' + buffer.toString('base64') }
}
