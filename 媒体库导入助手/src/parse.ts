/**
 * 解析文本中的 URL Scheme 导入链接。
 *
 * 典型的链接形如：
 *   rex://import?type=emby&scheme=https&host=emby.example.com&port=443&title=%F0%9F%8C%95MyServer&username=test&password=123456
 *   senplayer://importserver?type=emby&name=xxx&address=https://a.b:443&username=u&password=p
 *
 * 只要任意 Scheme（rex://、senplayer://、vidora://……）都能被识别。
 */

export interface SchemeEntry {
  /** 由原始链接哈希得到的稳定 id（不写入敏感内容） */
  id: string
  /** 原始链接字符串，最终就是用它去打开目标 App */
  raw: string
  /** URL Scheme，如 rex */
  scheme: string
  /** Scheme 之后的第一段，如 import / emby/import */
  action: string
  /** 服务器类型，如 emby / jellyfin */
  type: string
  /** 传输协议，如 https（链接里的 scheme 参数） */
  transport: string
  /** 显示名称，如 🌕MyServer */
  title: string
  host: string
  port: string
  username: string
  password: string
  /** 其余未归类的查询参数（如 scheme=https、backup=…） */
  extras: Array<{ key: string; value: string }>
  /** 全部查询参数（保留重复键，例如多条备用线路的 address=） */
  params: Array<{ key: string; value: string }>
  /** 是否是一条可用的导入链接 */
  valid: boolean
  /** 是否与前面的某条链接指向同一个服务器账号 */
  duplicate: boolean
  /** 缺失字段等提示 */
  issues: string[]
  /** 额外备注（如开通通知里的安全密码 / 到期时间），不写入导入链接（但会写进支持的 App 的备注字段） */
  note?: string
  /** 链接自带的备注参数（remark），部分 App 会用到 */
  remark?: string
}

export interface ParseResult {
  entries: SchemeEntry[]
  /** 没有任何链接的行 */
  invalidLines: string[]
  /** 总行数（非空） */
  lineCount: number
}

/** 匹配任意 scheme:// 之后不含空白的内容 */
const URL_PATTERN = /[A-Za-z][A-Za-z0-9+.\-]*:\/\/[^\s"'`<>\u3000]+/g
/** 链接末尾常见的标点（来自 Markdown、中文标点、括号等） */
const TRAILING_PATTERN = /[)\]}>.,;:!?、。，；：！？"'’”】》]+$/

const KEY_GROUPS = {
  type: ["type", "server_type", "servertype", "media_type"],
  host: [
    "host",
    "address",
    "server",
    "server_url",
    "serverurl",
    "server_address",
    "serveraddress",
    "url",
    "href",
    "domain",
    "endpoint",
    "ip",
  ],
  port: ["port"],
  title: ["title", "name", "alias", "display_name"],
  // SenPlayer 官方把服务器备注放在 note（不是名称）
  remark: ["remark", "note"],
  username: ["username", "user_name", "user", "account", "email"],
  password: ["password", "pass_word", "passwd", "pwd", "pass"],
  transport: ["scheme", "protocol"],
}

function decodeValue(value: string): string {
  if (!value || value.indexOf("%") < 0) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** djb2 哈希，用于生成不含敏感信息的稳定 id */
export function hashId(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

function queryPairs(query: string): Array<{ key: string; value: string }> {
  if (!query) return []
  const pairs: Array<{ key: string; value: string }> = []
  for (const chunk of query.split("&")) {
    if (!chunk) continue
    const eq = chunk.indexOf("=")
    const key = decodeValue(eq < 0 ? chunk : chunk.slice(0, eq)).trim()
    if (!key) continue
    const value = eq < 0 ? "" : decodeValue(chunk.slice(eq + 1))
    pairs.push({ key, value })
  }
  return pairs
}

function pick(pairs: Array<{ key: string; value: string }>, keys: string[]): string {
  for (const key of keys) {
    for (const pair of pairs) {
      if (pair.key.toLowerCase() === key && pair.value) return pair.value
    }
  }
  return ""
}

/** host 可能是裸主机名、也可能是带协议的完整地址 */
function splitHostPort(value: string): { host: string; port: string } {
  let text = value.trim()
  const schemeMatch = /^[A-Za-z][A-Za-z0-9+.\-]*:\/\/(.+)$/.exec(text)
  if (schemeMatch) text = schemeMatch[1]
  text = text.replace(/[/?#].*$/, "")
  text = text.replace(/^\[(.+)\]$/, "$1")
  const colon = text.lastIndexOf(":")
  if (colon > 0 && /^\d+$/.test(text.slice(colon + 1))) {
    return { host: text.slice(0, colon), port: text.slice(colon + 1) }
  }
  return { host: text, port: "" }
}

export function parseRaw(raw: string): SchemeEntry {
  const entry: SchemeEntry = {
    id: hashId(raw),
    raw,
    scheme: "",
    action: "",
    type: "",
    transport: "",
    title: "",
    host: "",
    port: "",
    username: "",
    password: "",
    extras: [],
    params: [],
    valid: false,
    duplicate: false,
    issues: [],
  }

  const match = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\/([^?#]*)(?:\?([^#]*))?(?:#([\s\S]*))?$/.exec(raw)
  if (!match) {
    entry.issues.push("无法解析")
    return entry
  }

  entry.scheme = match[1].toLowerCase()
  const path = (match[2] || "").replace(/^\/+|\/+$/g, "")
  if (path) entry.action = decodeValue(path)

  const pairs = queryPairs(match[3] || "")
  entry.params = pairs

  entry.type = pick(pairs, KEY_GROUPS.type).toLowerCase()
  entry.transport = pick(pairs, KEY_GROUPS.transport).toLowerCase()
  entry.title = pick(pairs, KEY_GROUPS.title)
  entry.remark = pick(pairs, KEY_GROUPS.remark) || undefined
  entry.username = pick(pairs, KEY_GROUPS.username)
  entry.password = pick(pairs, KEY_GROUPS.password)

  const hostValue = pick(pairs, KEY_GROUPS.host)
  const portValue = pick(pairs, KEY_GROUPS.port)
  if (hostValue) {
    if (!entry.transport) {
      const schemeMatch = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\//.exec(hostValue.trim())
      if (schemeMatch) entry.transport = schemeMatch[1].toLowerCase()
    }
    const split = splitHostPort(hostValue)
    entry.host = split.host
    entry.port = portValue || split.port
  } else {
    entry.port = portValue
  }
  if (!entry.host) {
    // 少数 Scheme 把主机名放在 Scheme 后的路径里，如 rex://emby.example.com:443?…
    if (path && /[.:]/.test(path) && !/[?=]/.test(path)) {
      const split = splitHostPort(path)
      if (/^[A-Za-z0-9._-]+$/.test(split.host) && split.host.indexOf(".") > 0) {
        entry.host = split.host
        entry.port = entry.port || split.port
        entry.action = ""
      }
    }
  }

  const known = new Set<string>()
  for (const keys of Object.values(KEY_GROUPS)) {
    for (const key of keys) known.add(key)
  }
  entry.extras = pairs.filter(pair => !known.has(pair.key.toLowerCase()))

  if (!entry.host) entry.issues.push("缺少服务器地址")
  if (!entry.username) entry.issues.push("缺少用户名")
  if (!entry.password) entry.issues.push("缺少密码")

  entry.valid = Boolean(entry.scheme && entry.host)
  return entry
}

/** 从任意文本（多行、含说明文字、Markdown、JSON 均可）中提取导入链接 */
export function parseEntries(text: string): ParseResult {
  const entries: SchemeEntry[] = []
  const invalidLines: string[] = []
  let lineCount = 0
  if (!text) return { entries, invalidLines, lineCount }

  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    lineCount++
    const matches = trimmed.match(URL_PATTERN)
    if (!matches || matches.length === 0) {
      invalidLines.push(trimmed)
      continue
    }
    for (const candidate of matches) {
      const raw = candidate.replace(TRAILING_PATTERN, "")
      if (!raw) continue
      const entry = parseRaw(raw)
      if (seenIds.has(entry.id)) continue
      seenIds.add(entry.id)
      if (entry.valid) {
        const key = entryDedupeKey(entry)
        if (seenKeys.has(key)) entry.duplicate = true
        else seenKeys.add(key)
      }
      entries.push(entry)
    }
  }

  return { entries, invalidLines, lineCount }
}

export function entryLabel(entry: SchemeEntry): string {
  if (entry.title) return entry.title
  if (entry.host) return `${entry.host}${entry.port ? ":" + entry.port : ""}`
  return entry.raw
}

export function entrySubtitle(entry: SchemeEntry): string {
  const parts: string[] = []
  parts.push((entry.type || entry.scheme).toUpperCase())
  if (entry.host) {
    const prefix = entry.transport ? `${entry.transport}://` : ""
    parts.push(`${prefix}${entry.host}${entry.port ? ":" + entry.port : ""}`)
  }
  if (entry.username) parts.push(entry.username)
  return parts.join(" · ")
}

/** 线路参数名（不同播放器叫法不同） */
export const LINE_PARAM_KEYS = ["backup", "backups", "line", "lines", "route", "routes"]

/** 判断同一台服务器账号：scheme + 类型 + 主机 + 端口 + 用户名 */
export function entryDedupeKey(entry: SchemeEntry): string {
  return [entry.scheme, entry.type, entry.host.toLowerCase(), entry.port, entry.username].join("|")
}

/** 线路参数（不带标题的那种，避免重复计数） */
const LINE_PARAM_RE = /^(line\d+|address\d+|backup|backups|backuphref|line|route|routes)$/
/** 线路的标题/名称参数，不计入「附加参数」 */
const LINE_TITLE_RE = /^(line\d+title|address\d+name)$/

/** 条目里携带的备用线路条数 */
export function entryLineCount(entry: SchemeEntry): number {
  let count = 0
  for (const item of entry.params) {
    const key = item.key.toLowerCase()
    if (!LINE_PARAM_RE.test(key)) continue
    // EplayerX 把所有线路塞进同一个 backupHref，只能按逗号数
    count += key === "backuphref" ? item.value.split(",").filter(value => value.trim()).length : 1
  }
  return count
}

/** 不属于线路、也不属于已知字段的其余参数个数 */
export function entryOtherParamCount(entry: SchemeEntry): number {
  return entry.extras.filter(item => {
    const key = item.key.toLowerCase()
    return !LINE_PARAM_RE.test(key) && !LINE_TITLE_RE.test(key)
  }).length
}

/** 列表中每行第三行的状态标识 */
export function entryBadges(entry: SchemeEntry, imported: boolean, duplicate: boolean): string[] {
  const badges: string[] = []
  if (imported) badges.push("已导入过")
  if (duplicate) badges.push("重复账号")
  if (!entry.password) badges.push("无密码")
  if (!entry.username) badges.push("无用户名")
  const lines = entryLineCount(entry)
  if (lines > 0) badges.push(`${lines} 条备用线路`)
  const others = entryOtherParamCount(entry)
  if (others > 0) badges.push(`${others} 个附加参数`)
  return badges
}
