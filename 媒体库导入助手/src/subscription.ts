/**
 * 把「订阅 JSON」（线路汇总文件）转换成 rex://import 导入链接。
 *
 * 支持的 JSON 形状（顶层数组，或 { servers / data / list / items / results: [...] }）：
 * {
 *   "originalAddress": "https://emby.example.com:443",
 *   "nowAddress": "https://emby.example.com:443",
 *   "account": "test",
 *   "password": "123456",
 *   "sourceType": "emby",
 *   "icon": "https://…png",
 *   "name": "🌕MyServer",
 *   "lines": [{ "address": "https://line1.example.com:443", "isNow": false, "name": "¹HKG" }]
 * }
 *
 * Rex 的 rex://import 只确认支持 type / scheme / host / port / title / username / password
 * （备用线路参数未确认，因此这里只导入主地址，lines 仅用于提示）。
 */

import type { SchemeEntry } from "./parse"
import { entryDedupeKey, parseRaw } from "./parse"

export interface SubscriptionLine {
  name: string
  address: string
}

export interface SubscriptionServer {
  name: string
  type: string
  address: string
  account: string
  password: string
  /** 备注（部分 App 会写入链接，如 EplayerX 的 remark；自定 URL Scheme 可用 {remark}） */
  remark?: string
  lines: SubscriptionLine[]
}

export interface SplitAddress {
  scheme: string
  host: string
  port: string
  path: string
}

const ADDRESS_KEYS = [
  "nowAddress",
  "now_address",
  "originalAddress",
  "original_address",
  "address",
  "serverUrl",
  "server_url",
  "url",
  "server",
  "host",
]

function pickString(source: any, keys: string[]): string {
  if (!source || typeof source !== "object") return ""
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return ""
}

/** https://host:443/path → { scheme, host, port, path } */
export function splitAddress(address: string): SplitAddress {
  const result: SplitAddress = { scheme: "", host: "", port: "", path: "" }
  let rest = (address || "").trim()
  if (!rest) return result
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\//.exec(rest)
  if (schemeMatch) {
    result.scheme = schemeMatch[1].toLowerCase()
    rest = rest.slice(schemeMatch[0].length)
  }
  const pathIndex = rest.indexOf("/")
  if (pathIndex >= 0) {
    result.path = rest.slice(pathIndex).replace(/\/+$/, "")
    rest = rest.slice(0, pathIndex)
  }
  const colon = rest.lastIndexOf(":")
  if (colon > 0 && /^\d+$/.test(rest.slice(colon + 1))) {
    result.host = rest.slice(0, colon)
    result.port = rest.slice(colon + 1)
  } else {
    result.host = rest
  }
  return result
}

function toServer(raw: any): SubscriptionServer | null {
  if (typeof raw === "string") {
    const address = raw.trim()
    return address ? { name: "", type: "emby", address, account: "", password: "", lines: [] } : null
  }
  if (!raw || typeof raw !== "object") return null

  const address = pickString(raw, ADDRESS_KEYS)
  const lines: SubscriptionLine[] = []
  const rawLines = raw.lines ?? raw.routes ?? raw.backup ?? raw.backups ?? raw.lineList
  if (Array.isArray(rawLines)) {
    for (const item of rawLines) {
      if (typeof item === "string") {
        const value = item.trim()
        if (value) lines.push({ name: "", address: value })
        continue
      }
      if (!item || typeof item !== "object") continue
      const lineAddress = pickString(item, ADDRESS_KEYS)
      if (lineAddress) lines.push({ name: pickString(item, ["name", "title", "remark", "tag"]), address: lineAddress })
    }
  }

  if (!address && lines.length === 0) return null
  return {
    name: pickString(raw, ["name", "title", "nickname", "displayName"]),
    type: (pickString(raw, ["sourceType", "source_type", "type", "serverType"]) || "emby").toLowerCase(),
    address: address || lines[0].address,
    account: pickString(raw, ["account", "username", "user", "email"]),
    password: pickString(raw, ["password", "pass", "pwd"]),
    lines,
  }
}

/**
 * 解析订阅 JSON；不像订阅文件时返回 null（交给普通链接解析）。
 */
export function parseSubscriptionJSON(text: string): SubscriptionServer[] | null {
  const trimmed = (text || "").trim()
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null

  let data: any
  try {
    data = JSON.parse(trimmed)
  } catch (error) {
    return null
  }

  let list: any[] = []
  if (Array.isArray(data)) list = data
  else if (data && typeof data === "object") {
    const containerKeys = ["servers", "data", "list", "items", "result", "results", "accounts"]
    for (const key of containerKeys) {
      if (Array.isArray(data[key])) {
        list = data[key]
        break
      }
    }
    if (list.length === 0) list = [data]
  }

  const servers: SubscriptionServer[] = []
  for (const item of list) {
    const server = toServer(item)
    if (server && splitAddress(server.address).host) servers.push(server)
  }
  return servers.length > 0 ? servers : null
}

/** 单条服务器 → 导入链接（具体格式由 src/apps.ts 提供） */
export interface ConvertedServers {
  entries: SchemeEntry[]
  /** 服务器台数 */
  serverCount: number
  /** 订阅里带有的备用线路条数 */
  lineCount: number
}

/**
 * 从一条导入链接里还原备用线路，兼容：
 * - Rex / Forward：lineNtitle / lineN
 * - SenPlayer：addressNname / addressN
 * - Vidora：backup=名称|地址（可重复）/ line=…
 * - EplayerX：一个 backupHref=地址;线路名，多条用「,」隔开
 * - lines=JSON 数组
 */
export function linesFromEntry(entry: SchemeEntry): SubscriptionLine[] {
  const indexed = new Map<number, SubscriptionLine>()
  const plain: SubscriptionLine[] = []

  for (const item of entry.params) {
    const key = item.key.toLowerCase()
    const titleMatch = /^line(\d+)title$/.exec(key)
    if (titleMatch) {
      const index = Number(titleMatch[1])
      const line = indexed.get(index) ?? { name: "", address: "" }
      line.name = item.value
      indexed.set(index, line)
      continue
    }
    const addressMatch = /^line(\d+)$/.exec(key)
    if (addressMatch) {
      const index = Number(addressMatch[1])
      const line = indexed.get(index) ?? { name: "", address: "" }
      line.address = item.value
      indexed.set(index, line)
      continue
    }
    // SenPlayer：address1name / address1、address2name / address2 …
    const senNameMatch = /^address(\d+)name$/.exec(key)
    if (senNameMatch) {
      const index = Number(senNameMatch[1])
      const line = indexed.get(index) ?? { name: "", address: "" }
      line.name = item.value
      indexed.set(index, line)
      continue
    }
    const senAddressMatch = /^address(\d+)$/.exec(key)
    if (senAddressMatch) {
      const index = Number(senAddressMatch[1])
      const line = indexed.get(index) ?? { name: "", address: "" }
      line.address = item.value
      indexed.set(index, line)
      continue
    }
    if (key === "backuphref") {
      // EplayerX：多条塞在同一个参数里，条与条用「,」分开，每条「地址;线路名」（与 Vidora 的 名称|地址 相反）
      for (const group of item.value.split(",")) {
        const separator = group.indexOf(";")
        const address = separator >= 0 ? group.slice(0, separator) : group
        const name = separator >= 0 ? group.slice(separator + 1) : ""
        if (address.trim()) plain.push({ name: name.trim(), address: address.trim() })
      }
      continue
    }
    if (key === "backup" || key === "line" || key === "route") {
      const separator = item.value.indexOf("|")
      const name = separator >= 0 ? item.value.slice(0, separator) : ""
      const address = separator >= 0 ? item.value.slice(separator + 1) : item.value
      if (address) plain.push({ name, address })
      continue
    }
    if (key === "lines") {
      try {
        const parsed = JSON.parse(item.value)
        if (Array.isArray(parsed)) {
          for (const raw of parsed) {
            const address = pickString(raw, ADDRESS_KEYS)
            if (address) plain.push({ name: pickString(raw, ["name", "title"]), address })
          }
        }
      } catch (error) {
        // 不是 JSON 就忽略
      }
    }
  }

  const ordered = Array.from(indexed.keys())
    .sort((a, b) => a - b)
    .map(index => indexed.get(index) as SubscriptionLine)
    .filter(line => !!line.address)

  return [...ordered, ...plain]
}

/** 从已解析的条目还原出服务器信息（用于切换目标 App 时重新生成链接） */
export function serverFromEntry(entry: SchemeEntry): SubscriptionServer {
  const pathParam = entry.params.find(item => item.key.toLowerCase() === "server_path")
  const protocol = entry.transport || "https"
  const address = entry.host
    ? `${protocol}://${entry.host}${entry.port ? ":" + entry.port : ""}${pathParam ? pathParam.value : ""}`
    : entry.raw
  return {
    name: entry.title,
    type: entry.type || "emby",
    address,
    account: entry.username,
    password: entry.password,
    // 只取链接自带的 remark；开通通知备注（entry.note，含安全密码）不写入链接
    remark: entry.remark,
    lines: linesFromEntry(entry),
  }
}

/** 一批服务器 → 可导入条目（复用 parse.ts 的解析，保证展示与校验一致） */
export function serversToEntries(
  servers: SubscriptionServer[],
  build: (server: SubscriptionServer) => string
): ConvertedServers {
  const entries: SchemeEntry[] = []
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  let lineCount = 0

  for (const server of servers) {
    const entry = parseRaw(build(server))
    lineCount += server.lines.length
    if (seenIds.has(entry.id)) continue
    seenIds.add(entry.id)
    if (entry.valid) {
      const key = entryDedupeKey(entry)
      if (seenKeys.has(key)) entry.duplicate = true
      else seenKeys.add(key)
    }
    entries.push(entry)
  }

  return { entries, serverCount: servers.length, lineCount }
}
