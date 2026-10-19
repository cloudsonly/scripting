declare const fetch: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export interface IconEntry {
  name: string
  url: string
}

export interface IconLibraryContent {
  name: string
  description: string
  icons: IconEntry[]
}

const MAX_NAME = 60
const MAX_DESCRIPTION = 200
const MAX_ICONS = 2000

const cache = new Map<string, IconLibraryContent>()

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function iconFallbackName(url: string): string {
  const path = String(url || "").split(/[?#]/)[0]
  const last = path.split("/").pop() || path
  const dot = last.lastIndexOf(".")
  return decodeSafe(dot > 0 ? last.slice(0, dot) : last).slice(0, MAX_NAME)
}

export function parseIconLibrary(text: string): IconLibraryContent | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== "object") return null
  const payload = data as Record<string, unknown>
  if (!Array.isArray(payload.icons)) return null

  const icons: IconEntry[] = []
  const seen = new Set<string>()
  for (const item of payload.icons) {
    if (icons.length >= MAX_ICONS) break
    if (!item || typeof item !== "object") continue
    const entry = item as Record<string, unknown>
    const url = cleanText(entry.url, 800)
    if (!url || seen.has(url)) continue
    seen.add(url)
    icons.push({ name: cleanText(entry.name, MAX_NAME) || iconFallbackName(url), url })
  }
  if (icons.length === 0) return null

  return {
    name: cleanText(payload.name, MAX_NAME),
    description: cleanText(payload.description, MAX_DESCRIPTION),
    icons,
  }
}

export function cachedLibrary(url: string): IconLibraryContent | null {
  return cache.get(url) || null
}

export async function loadIconLibrary(url: string, refresh: boolean): Promise<IconLibraryContent> {
  const target = String(url || "").trim()
  if (!target) throw new Error("图标库地址为空")
  if (!refresh) {
    const hit = cache.get(target)
    if (hit) return hit
  }
  const response = await fetch(target)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const parsed = parseIconLibrary(await response.text())
  if (!parsed) throw new Error("文件不是图标库格式：顶层需要有 name 与 icons 数组")
  cache.set(target, parsed)
  return parsed
}

export function filterIcons(icons: IconEntry[], keyword: string, limit = 0): IconEntry[] {
  const key = String(keyword || "").trim().toLowerCase()
  const out: IconEntry[] = []
  for (const item of icons) {
    if (limit > 0 && out.length >= limit) break
    if (!key || item.name.toLowerCase().indexOf(key) >= 0 || item.url.toLowerCase().indexOf(key) >= 0) out.push(item)
  }
  return out
}
