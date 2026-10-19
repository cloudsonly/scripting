export interface SchemeEntry {
  id: string
  raw: string
  scheme: string
  action: string
  type: string
  transport: string
  title: string
  host: string
  port: string
  username: string
  password: string
  extras: Array<{ key: string; value: string }>
  params: Array<{ key: string; value: string }>
  valid: boolean
  duplicate: boolean
  issues: string[]
  remark?: string
}

export interface ParseResult {
  entries: SchemeEntry[]
  invalidLines: string[]
  lineCount: number
}

const URL_PATTERN = /[A-Za-z][A-Za-z0-9+.\-]*:\/\/[^\s"'`<>\u3000]+/g
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

export function entryDedupeKey(entry: SchemeEntry): string {
  return [entry.scheme, entry.type, entry.host.toLowerCase(), entry.port, entry.username].join("|")
}

const SECRET_PARAM_RE = /^(password|pass_word|passwd|pwd|pass)$/

export function maskSecrets(raw: string): string {
  if (!raw) return raw
  return raw.replace(/([?&])([A-Za-z_][A-Za-z0-9_]*)=([^&]*)/g, (whole, sep: string, key: string) =>
    SECRET_PARAM_RE.test(key.toLowerCase()) ? `${sep}${key}=••••••` : whole
  )
}

const LINE_PARAM_RE = /^(line\d+|address\d+|backup|backups|backuphref|line|route|routes)$/
const LINE_TITLE_RE = /^(line\d+title|address\d+name)$/

export function entryLineCount(entry: SchemeEntry): number {
  let count = 0
  for (const item of entry.params) {
    const key = item.key.toLowerCase()
    if (!LINE_PARAM_RE.test(key)) continue
    count += key === "backuphref" ? item.value.split(",").filter(value => value.trim()).length : 1
  }
  return count
}

export function entryOtherParamCount(entry: SchemeEntry): number {
  return entry.extras.filter(item => {
    const key = item.key.toLowerCase()
    return !LINE_PARAM_RE.test(key) && !LINE_TITLE_RE.test(key)
  }).length
}

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
