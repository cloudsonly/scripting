import type { LibraryGroup, LibraryServer } from "./library"
import {
  findServerIndex,
  mergeServer,
  newServerId,
  normalizeName,
  normalizeTags,
} from "./library"
import type { SavedIconLibrary, SavedTemplate } from "./store"
import type { SubscriptionLine } from "./subscription"

export const BACKUP_KIND = "EmbyLibraryKit-backup"
export const BACKUP_SCHEMA = 2

export interface BackupContent {
  servers: LibraryServer[]
  groups: LibraryGroup[]
  templates: SavedTemplate[]
  iconLibraries: SavedIconLibrary[]
}

function text(value: unknown, max = 400): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, max)
}

function time(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

function readLines(value: unknown): SubscriptionLine[] {
  if (!Array.isArray(value)) return []
  const out: SubscriptionLine[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const address = text((item as Record<string, unknown>).address, 600)
    if (!address) continue
    out.push({ name: text((item as Record<string, unknown>).name, 60), address })
  }
  return out
}

function readServer(value: unknown): LibraryServer | null {
  if (!value || typeof value !== "object") return null
  const item = value as Record<string, unknown>
  const address = text(item.address, 600)
  const lines = readLines(item.lines)
  if (!address && lines.length === 0) return null
  return {
    id: text(item.id, 80) || `srv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: text(item.name, 120),
    type: text(item.type, 20).toLowerCase() || "emby",
    address,
    account: text(item.account, 120),
    password: typeof item.password === "string" ? item.password : "",
    remark: text(item.remark, 200),
    icon: text(item.icon, 600),
    groupId: text(item.groupId, 80),
    tags: normalizeTags(Array.isArray(item.tags) ? (item.tags as string[]) : []),
    lines,
    createdAt: time(item.createdAt),
    updatedAt: time(item.updatedAt),
  }
}

function readIconLibrary(value: unknown): SavedIconLibrary | null {
  if (!value || typeof value !== "object") return null
  const item = value as Record<string, unknown>
  const url = text(item.url, 800)
  if (!url) return null
  return {
    id: text(item.id, 80) || `ic-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    url,
    name: text(item.name, 120),
    count: typeof item.count === "number" && Number.isFinite(item.count) && item.count > 0 ? item.count : 0,
    addedAt: time(item.addedAt),
  }
}

export function buildBackupJSON(
  servers: LibraryServer[],
  groups: LibraryGroup[],
  templates: SavedTemplate[],
  iconLibraries: SavedIconLibrary[],
  appVersion: string
): string {
  return JSON.stringify(
    {
      kind: BACKUP_KIND,
      schema: BACKUP_SCHEMA,
      exportedAt: Date.now(),
      appVersion,
      count: { servers: servers.length, groups: groups.length, templates: templates.length, iconLibraries: iconLibraries.length },
      servers,
      groups,
      templates,
      iconLibraries,
    },
    null,
    2
  )
}

export function isBackupJSON(text: string): boolean {
  return text.indexOf(BACKUP_KIND) >= 0
}

export function parseBackupJSON(source: string): BackupContent | null {
  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    return null
  }
  if (!data || typeof data !== "object") return null
  const payload = data as Record<string, unknown>
  if (payload.kind !== BACKUP_KIND) return null
  if (!Array.isArray(payload.servers)) return null

  const servers: LibraryServer[] = []
  for (const item of payload.servers) {
    const server = readServer(item)
    if (server) servers.push(server)
  }

  const groups: LibraryGroup[] = []
  if (Array.isArray(payload.groups)) {
    for (const item of payload.groups) {
      if (!item || typeof item !== "object") continue
      const id = text((item as Record<string, unknown>).id, 80)
      const name = text((item as Record<string, unknown>).name, 60)
      if (!id || !name || groups.some(group => group.id === id)) continue
      groups.push({ id, name })
    }
  }

  const templates: SavedTemplate[] = []
  if (Array.isArray(payload.templates)) {
    for (const item of payload.templates) {
      if (!item || typeof item !== "object") continue
      const id = text((item as Record<string, unknown>).id, 80)
      const body = typeof (item as Record<string, unknown>).template === "string" ? ((item as Record<string, unknown>).template as string).trim() : ""
      if (!id || !body || templates.some(template => template.id === id)) continue
      templates.push({ id, name: text((item as Record<string, unknown>).name, 120), template: body })
    }
  }

  const iconLibraries: SavedIconLibrary[] = []
  if (Array.isArray(payload.iconLibraries)) {
    for (const item of payload.iconLibraries) {
      const library = readIconLibrary(item)
      if (library && !iconLibraries.some(existing => existing.url === library.url)) iconLibraries.push(library)
    }
  }

  if (servers.length === 0 && groups.length === 0 && templates.length === 0 && iconLibraries.length === 0) return null
  return { servers, groups, templates, iconLibraries }
}

export interface BackupMergeResult {
  servers: LibraryServer[]
  groups: LibraryGroup[]
  added: number
  updated: number
}

export function mergeBackup(
  servers: LibraryServer[],
  groups: LibraryGroup[],
  content: BackupContent
): BackupMergeResult {
  const nextGroups = groups.slice()
  const groupMap = new Map<string, string>()

  for (const group of content.groups) {
    const sameId = nextGroups.find(item => item.id === group.id)
    if (sameId) {
      groupMap.set(group.id, sameId.id)
      continue
    }
    const sameName = nextGroups.find(item => normalizeName(item.name) === normalizeName(group.name))
    if (sameName) {
      groupMap.set(group.id, sameName.id)
      continue
    }
    nextGroups.push(group)
    groupMap.set(group.id, group.id)
  }

  const list = servers.slice()
  let added = 0
  let updated = 0
  let at = Date.now()

  for (const item of content.servers) {
    at += 1
    const groupId = item.groupId ? groupMap.get(item.groupId) || "" : ""
    const index = findServerIndex(list, item)
    if (index < 0) {
      list.push({
        ...item,
        id: newServerId(),
        groupId,
        tags: normalizeTags(item.tags),
        createdAt: at,
        updatedAt: at,
      })
      added++
      continue
    }
    const existing = list[index]
    list[index] = {
      ...mergeServer(existing, item, at),
      groupId: existing.groupId || groupId,
      tags: normalizeTags(existing.tags.concat(item.tags)),
    }
    updated++
  }

  return { servers: list, groups: nextGroups, added, updated }
}

export function mergeTemplates(current: SavedTemplate[], incoming: SavedTemplate[]): { list: SavedTemplate[]; added: number } {  const list = current.slice()
  let added = 0
  for (const item of incoming) {
    if (!item.template) continue
    const index = list.findIndex(existing => existing.id === item.id)
    if (index >= 0) {
      if (!list[index].name && item.name) list[index] = { ...list[index], name: item.name }
      continue
    }
    if (list.some(existing => normalizeName(existing.name) === normalizeName(item.name))) continue
    list.push({ id: newServerId(), name: item.name, template: item.template })
    added++
  }
  return { list, added }
}

export function mergeIconLibraries(
  current: SavedIconLibrary[],
  incoming: SavedIconLibrary[]
): { list: SavedIconLibrary[]; added: number } {
  const list = current.slice()
  let added = 0
  for (const item of incoming) {
    if (!item.url) continue
    const index = list.findIndex(existing => existing.url === item.url)
    if (index >= 0) {
      if (!list[index].name && item.name) list[index] = { ...list[index], name: item.name, count: item.count }
      continue
    }
    if (list.some(existing => existing.id === item.id)) {
      list.push({ ...item, id: newServerId() })
    } else {
      list.push(item)
    }
    added++
  }
  return { list, added }
}
