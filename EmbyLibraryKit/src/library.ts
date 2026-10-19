import type { SubscriptionLine, SubscriptionServer } from "./subscription"

export interface LibraryGroup {
  id: string
  name: string
}

export interface LibraryServer {
  id: string
  name: string
  type: string
  address: string
  account: string
  password: string
  remark: string
  icon: string
  groupId: string
  tags: string[]
  lines: SubscriptionLine[]
  createdAt: number
  updatedAt: number
}

const KEY_SERVERS = "schemeBatch.library"
const KEY_GROUPS = "schemeBatch.groups"
const KEY_SECRETS = "schemeBatch.serverPasswords"

export const UNGROUPED = ""
export const MAX_TAGS = 12

export function normalizeTags(input: string | string[]): string[] {
  const parts = Array.isArray(input)
    ? input.map(item => String(item || ""))
    : String(input || "").split(/[\s,，、;；|/]+/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of parts) {
    const tag = raw.trim().slice(0, 20)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export function allTags(
  servers: LibraryServer[],
  selected: string[] = []
): Array<{ tag: string; count: number }> {
  const owned = servers.map(server => normalizeTags(server.tags).map(tag => tag.toLowerCase()))
  const names = new Map<string, string>()
  for (const server of servers) {
    for (const tag of normalizeTags(server.tags)) names.set(tag.toLowerCase(), tag)
  }
  const chosen = selected.map(tag => String(tag || "").trim().toLowerCase()).filter(tag => !!tag)
  const out: Array<{ tag: string; count: number }> = []
  for (const [key, tag] of names) {
    const others = chosen.filter(item => item !== key)
    let count = 0
    for (const list of owned) {
      if (list.indexOf(key) < 0) continue
      if (others.every(item => list.indexOf(item) >= 0)) count++
    }
    out.push({ tag, count })
  }
  return out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export function orderTags(
  items: Array<{ tag: string; count: number }>,
  order: string[]
): Array<{ tag: string; count: number }> {
  if (!Array.isArray(order) || order.length === 0) return items
  const byKey = new Map<string, { tag: string; count: number }>()
  for (const item of items) byKey.set(item.tag.toLowerCase(), item)
  const placed: Array<{ tag: string; count: number }> = []
  const seen = new Set<string>()
  for (const raw of order) {
    const key = String(raw || "").trim().toLowerCase()
    if (!key || seen.has(key)) continue
    const found = byKey.get(key)
    if (!found) continue
    seen.add(key)
    placed.push(found)
  }
  return placed.concat(items.filter(item => !seen.has(item.tag.toLowerCase())))
}

export function hasTags(server: LibraryServer, tags: string[]): boolean {
  if (tags.length === 0) return true
  const owned = new Set(normalizeTags(server.tags).map(item => item.toLowerCase()))
  return tags.every(tag => owned.has(tag.toLowerCase()))
}

export function applyTagsTo(
  list: LibraryServer[],
  ids: string[],
  tags: string[],
  add: boolean
): LibraryServer[] {
  const wanted = normalizeTags(tags)
  const set = new Set(ids)
  return list.map(server => {
    if (!set.has(server.id)) return server
    if (add) return { ...server, tags: normalizeTags(server.tags.concat(wanted)) }
    const drop = new Set(wanted.map(item => item.toLowerCase()))
    return { ...server, tags: normalizeTags(server.tags.filter(item => !drop.has(item.toLowerCase()))) }
  })
}

export function removeTag(list: LibraryServer[], tag: string): LibraryServer[] {
  const drop = String(tag || "").trim().toLowerCase()
  if (!drop) return list.slice()
  return list.map(server => ({ ...server, tags: server.tags.filter(item => item.toLowerCase() !== drop) }))
}

export function renameTag(list: LibraryServer[], from: string, to: string): LibraryServer[] {
  const source = String(from || "").trim().toLowerCase()
  const target = normalizeTags(to)[0] || ""
  if (!source || !target || source === target.toLowerCase()) return list.slice()
  return list.map(server => {
    if (!server.tags.some(item => item.toLowerCase() === source)) return server
    const rest = server.tags.filter(item => item.toLowerCase() !== source)
    return { ...server, tags: normalizeTags(rest.concat(target)) }
  })
}

export type SortKey = "name" | "created" | "updated"

export const SORT_LABELS: Record<SortKey, string> = {
  name: "名称",
  created: "创建日期",
  updated: "修改日期",
}

export const SORT_KEYS: SortKey[] = ["name", "created", "updated"]

function sortValue(server: LibraryServer, key: SortKey): string | number {
  if (key === "created") return server.createdAt || 0
  if (key === "updated") return server.updatedAt || 0
  return normalizeName(server.name) || normalizeAddress(server.address)
}

export function sortServers(list: LibraryServer[], key: SortKey, descending: boolean): LibraryServer[] {
  const out = list.slice()
  out.sort((a, b) => {
    const left = sortValue(a, key)
    const right = sortValue(b, key)
    let diff = 0
    if (typeof left === "number" && typeof right === "number") diff = left - right
    else diff = String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
    if (diff !== 0) return descending ? -diff : diff
    return (a.createdAt || 0) - (b.createdAt || 0)
  })
  return out
}

export function normalizeName(name: string): string {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase()
}

export function normalizeAddress(address: string): string {
  let text = String(address || "").trim()
  if (!text) return ""
  const protocol = text.indexOf("://")
  if (protocol >= 0) text = text.slice(protocol + 3)
  text = text.replace(/\/+$/, "")
  const slash = text.indexOf("/")
  const host = slash < 0 ? text : text.slice(0, slash)
  const path = slash < 0 ? "" : text.slice(slash)
  return host.toLowerCase() + path
}

export function findServerIndex(
  list: LibraryServer[],
  incoming: Pick<LibraryServer, "name" | "address" | "lines">
): number {
  const incomingKeys = addressKeys(incoming)
  if (incomingKeys.length > 0) {
    let best = -1
    let bestShared = 0
    for (let index = 0; index < list.length; index++) {
      const shared = countShared(incomingKeys, addressKeys(list[index]))
      if (shared > bestShared) {
        bestShared = shared
        best = index
      }
    }
    if (best >= 0) return best
  }
  const nameKey = normalizeName(incoming.name)
  if (nameKey) {
    for (let index = 0; index < list.length; index++) {
      if (normalizeName(list[index].name) === nameKey) return index
    }
  }
  return -1
}

export function addressKeys(server: Pick<LibraryServer, "address" | "lines">): string[] {
  const set = new Set<string>()
  const main = normalizeAddress(server.address)
  if (main) set.add(main)
  for (const line of server.lines || []) {
    const key = normalizeAddress(line && line.address)
    if (key) set.add(key)
  }
  return Array.from(set)
}

function countShared(a: string[], b: string[]): number {
  if (a.length > b.length) {
    const swap = a
    a = b
    b = swap
  }
  const inB = new Set(b)
  let shared = 0
  for (const item of a) {
    if (inB.has(item)) shared++
  }
  return shared
}

export function mergeLines(existing: LibraryServer, incoming: LibraryServer): SubscriptionLine[] {
  const result = existing.lines.slice()
  const seen = new Set(result.map(line => normalizeAddress(line.address)))
  for (const line of incoming.lines) {
    const key = normalizeAddress(line.address)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({ name: line.name || `线路${result.length + 1}`, address: line.address })
  }
  return result
}

export function lineSequence(server: LibraryServer): SubscriptionLine[] {
  const out: SubscriptionLine[] = []
  const primary = String(server.address || "").trim()
  if (primary) out.push({ name: "", address: primary })
  for (const line of server.lines) {
    const address = String(line.address || "").trim()
    if (address) out.push({ name: String(line.name || "").trim(), address })
  }
  return out
}

export function orderLines(
  existing: LibraryServer,
  incoming: LibraryServer,
  primaryAddress: string
): SubscriptionLine[] {
  const names = new Map<string, string>()
  for (const item of lineSequence(existing).concat(lineSequence(incoming))) {
    const key = normalizeAddress(item.address)
    if (item.name && !names.get(key)) names.set(key, item.name)
  }
  const ordered: SubscriptionLine[] = []
  const seen = new Set<string>()
  function push(address: string) {
    const key = normalizeAddress(address)
    if (!key || seen.has(key)) return
    seen.add(key)
    ordered.push({ name: names.get(key) || "", address: address.trim() })
  }
  for (const item of lineSequence(incoming)) push(item.address)
  for (const item of lineSequence(existing)) push(item.address)
  const primary = normalizeAddress(primaryAddress)
  const rest = ordered.filter(item => normalizeAddress(item.address) !== primary)
  return rest.map((item, index) => ({ name: item.name || `线路${index + 2}`, address: item.address }))
}

export function dropAddressFromLines(lines: SubscriptionLine[], address: string): SubscriptionLine[] {
  const key = normalizeAddress(address)
  if (!key) return lines.slice()
  return lines.filter(line => normalizeAddress(line.address) !== key)
}

export type DiffField = "name" | "type" | "account" | "password" | "address" | "lines" | "icon" | "remark"

export const DIFF_FIELD_LABELS: Record<DiffField, string> = {
  name: "名称",
  type: "类型",
  account: "用户名",
  password: "密码",
  address: "主线路",
  lines: "备用线路",
  icon: "图标",
  remark: "备注",
}

export function diffServerFields(existing: LibraryServer, incoming: LibraryServer): DiffField[] {
  const fields: DiffField[] = []
  const push = (field: DiffField, left: string, right: string) => {
    if (String(left || "").trim() !== String(right || "").trim()) fields.push(field)
  }
  push("name", existing.name, incoming.name)
  push("type", existing.type, incoming.type)
  push("account", existing.account, incoming.account)
  push("password", existing.password, incoming.password)
  push("address", existing.address, incoming.address)
  push("icon", existing.icon, incoming.icon)
  push("remark", existing.remark, incoming.remark)
  const oldLines = existing.lines.map(line => normalizeAddress(line.address)).join("|")
  const newLines = incoming.lines.map(line => normalizeAddress(line.address)).join("|")
  if (oldLines !== newLines) fields.push("lines")
  return fields
}

export function applyChosenFields(
  existing: LibraryServer,
  incoming: LibraryServer,
  fields: DiffField[],
  now: number
): LibraryServer {
  const next: LibraryServer = { ...existing, updatedAt: now }
  const want = new Set(fields)
  if (want.has("name") && incoming.name.trim()) next.name = incoming.name.trim()
  if (want.has("type") && incoming.type.trim()) next.type = incoming.type.trim().toLowerCase()
  if (want.has("account") && incoming.account.trim()) next.account = incoming.account.trim()
  if (want.has("password") && incoming.password) next.password = incoming.password
  if (want.has("address") && incoming.address.trim()) next.address = incoming.address.trim()
  if (want.has("icon")) next.icon = incoming.icon.trim() || existing.icon
  if (want.has("remark") && incoming.remark.trim()) next.remark = incoming.remark.trim()
  if (want.has("lines")) next.lines = orderLines(existing, incoming, next.address)
  else if (want.has("address")) next.lines = dropAddressFromLines(existing.lines, next.address)
  return next
}

export function mergeServer(existing: LibraryServer, incoming: LibraryServer, now: number): LibraryServer {
  const address = incoming.address || existing.address
  return {
    ...existing,
    name: incoming.name.trim() || existing.name,
    type: (incoming.type || existing.type || "emby").toLowerCase(),
    address,
    account: incoming.account || existing.account,
    password: incoming.password || existing.password,
    remark: incoming.remark || existing.remark,
    icon: incoming.icon || existing.icon,
    lines: orderLines(existing, incoming, address),
    groupId: existing.groupId,
    createdAt: existing.createdAt,
    updatedAt: now,
  }
}

export interface UpsertResult {
  list: LibraryServer[]
  added: number
  updated: number
}

export function upsertServers(
  current: LibraryServer[],
  incoming: LibraryServer[],
  now: number
): UpsertResult {
  const list = current.slice()
  let added = 0
  let updated = 0
  for (const item of incoming) {
    const index = findServerIndex(list, item)
    const at = now + added + updated
    if (index < 0) {
      list.push({ ...item, createdAt: at, updatedAt: at })
      added++
    } else {
      list[index] = mergeServer(list[index], item, at)
      updated++
    }
  }
  return { list, added, updated }
}

export function toSubscriptionServer(item: LibraryServer): SubscriptionServer {
  return {
    name: item.name,
    type: item.type || "emby",
    address: item.address,
    account: item.account,
    password: item.password,
    remark: item.remark ? item.remark : undefined,
    lines: item.lines.slice(),
  }
}

export function fromSubscriptionServer(
  server: SubscriptionServer,
  extra?: { id?: string; icon?: string; groupId?: string; tags?: string[]; at?: number }
): LibraryServer {
  const at = extra && extra.at ? extra.at : 0
  return {
    id: (extra && extra.id) || "",
    name: (server.name || "").trim(),
    type: (server.type || "emby").toLowerCase(),
    address: server.address || "",
    account: server.account || "",
    password: server.password || "",
    remark: server.remark || "",
    icon: (extra && extra.icon) || "",
    groupId: (extra && extra.groupId) || UNGROUPED,
    tags: normalizeTags((extra && extra.tags) || []),
    lines: (server.lines || []).slice(),
    createdAt: at,
    updatedAt: at,
  }
}

interface AfusektLine {
  address: string
  isNow: boolean
  name: string
}

interface AfusektServer {
  originalAddress: string
  nowAddress: string
  account: string
  password: string
  sourceType: string
  icon: string
  name: string
  lines: AfusektLine[]
}

export function parseAfusektJSON(text: string): LibraryServer[] | null {
  const raw = String(text || "").trim()
  if (!raw) return null
  let data: any = null
  try {
    data = JSON.parse(raw)
  } catch (error) {
    return null
  }
  let items: any = null
  if (Array.isArray(data)) items = data
  else if (data && typeof data === "object") {
    for (const key of ["servers", "data", "list", "items", "results"]) {
      if (Array.isArray(data[key])) {
        items = data[key]
        break
      }
    }
  }
  if (!Array.isArray(items) || items.length === 0) return null

  const list: LibraryServer[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const address = readString(item, ["nowAddress", "originalAddress", "address", "url", "serverUrl", "server_url", "host"])
    const name = readString(item, ["name", "title", "alias", "displayName"])
    if (!address && !name) continue
    const lines: SubscriptionLine[] = []
    if (Array.isArray(item.lines)) {
      for (const line of item.lines) {
        if (!line || typeof line !== "object") continue
        const lineAddress = readString(line, ["address", "url", "nowAddress", "originalAddress"])
        if (!lineAddress) continue
        lines.push({ name: readString(line, ["name", "title", "lineName"]), address: lineAddress })
      }
    }
    list.push({
      id: "",
      name,
      type: (readString(item, ["sourceType", "type", "serverType"]) || "emby").toLowerCase(),
      address,
      account: readString(item, ["account", "username", "user", "email"]),
      password: readString(item, ["password", "pass", "pwd"]),
      remark: readString(item, ["remark", "note"]),
      icon: readString(item, ["icon", "avatar", "image"]),
      groupId: UNGROUPED,
      tags: [],
      lines,
      createdAt: 0,
      updatedAt: 0,
    })
  }
  return list.length > 0 ? list : null
}

function readString(source: any, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return ""
}

export function toAfusektJSON(list: LibraryServer[]): string {
  const items: AfusektServer[] = list.map(server => {
    const address = server.address || (server.lines[0] ? server.lines[0].address : "")
    return {
      originalAddress: address,
      nowAddress: address,
      account: server.account,
      password: server.password,
      sourceType: server.type || "emby",
      icon: server.icon || "",
      name: server.name,
      lines: server.lines.map(line => ({ address: line.address, isNow: false, name: line.name || "" })),
    }
  })
  return escapeNonASCII(JSON.stringify(items))
}

function escapeNonASCII(text: string): string {
  let out = ""
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code >= 0x20 && code <= 0x7e) {
      out += text[index]
      continue
    }
    out += "\\u" + code.toString(16).toUpperCase().padStart(4, "0")
  }
  return out
}

type StoredServer = Omit<LibraryServer, "password">

function readSecretMap(): Record<string, string> {
  try {
    const text = Keychain.get(KEY_SECRETS)
    if (!text) return {}
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") return {}
    const map: Record<string, string> = {}
    for (const key of Object.keys(parsed)) {
      const value = parsed[key]
      if (typeof value === "string") map[key] = value
    }
    return map
  } catch (error) {
    console.log("readSecretMap failed", error)
    return {}
  }
}

function writeSecretMap(secrets: Record<string, string>): boolean {
  try {
    if (Object.keys(secrets).length === 0) return Keychain.remove(KEY_SECRETS)
    return Keychain.set(KEY_SECRETS, JSON.stringify(secrets), { accessibility: "first_unlock_this_device" })
  } catch (error) {
    console.log("writeSecretMap failed", error)
    return false
  }
}

export interface LibraryState {
  servers: LibraryServer[]
  groups: LibraryGroup[]
}

export function loadLibrary(): LibraryState {
  let servers: LibraryServer[] = []
  try {
    const stored = Storage.get<StoredServer[]>(KEY_SERVERS)
    if (Array.isArray(stored)) {
      const secrets = readSecretMap()
      servers = stored
        .filter(item => item && typeof item.id === "string")
        .map(item => {
          const server = { ...(item as LibraryServer) }
          delete (server as Partial<LibraryServer & { note?: string }>).note
          server.tags = normalizeTags((item as Partial<LibraryServer>).tags || [])
          server.password = secrets[item.id] || ""
          return server
        })
    }
  } catch (error) {
    console.log("loadLibrary failed", error)
  }
  let groups: LibraryGroup[] = []
  try {
    const stored = Storage.get<LibraryGroup[]>(KEY_GROUPS)
    if (Array.isArray(stored)) {
      groups = stored.filter(item => item && typeof item.id === "string" && typeof item.name === "string")
    }
  } catch (error) {
    console.log("loadGroups failed", error)
  }
  return { servers, groups }
}

export function saveLibrary(servers: LibraryServer[], groups: LibraryGroup[]): boolean {
  try {
    const secrets: Record<string, string> = {}
    const meta: StoredServer[] = servers.map(server => {
      if (server.password) secrets[server.id] = server.password
      const copy = { ...server } as LibraryServer
      delete (copy as Partial<LibraryServer>).password
      return copy as StoredServer
    })
    const secretsSaved = writeSecretMap(secrets)
    const serversSaved = Storage.set(KEY_SERVERS, meta)
    const groupsSaved = Storage.set(KEY_GROUPS, groups)
    return serversSaved && groupsSaved && secretsSaved
  } catch (error) {
    console.log("saveLibrary failed", error)
    return false
  }
}

export function newServerId(): string {
  return UUID.string()
}

export function dropGroup(
  servers: LibraryServer[],
  groups: LibraryGroup[],
  groupId: string
): { servers: LibraryServer[]; groups: LibraryGroup[] } {
  return {
    servers: servers.map(server => (server.groupId === groupId ? { ...server, groupId: UNGROUPED } : server)),
    groups: groups.filter(item => item.id !== groupId),
  }
}
