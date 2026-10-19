import type { AppId } from "./apps"
import { isAppId } from "./apps"
import type { SortKey } from "./library"
import { SORT_KEYS } from "./library"

export interface Settings {
  skipDone: boolean
  notify: boolean
  buttonFX: boolean
  appId: AppId
  customTemplate: string
  activeTemplateId?: string
  librarySort: SortKey
  librarySortDesc: boolean
  tagOrder: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  skipDone: true,
  notify: true,
  buttonFX: true,
  appId: "rex",
  customTemplate: "",
  librarySort: "name",
  librarySortDesc: false,
  tagOrder: [],
}

export interface HistoryRecord {
  id: string
  title: string
  host: string
  account: string
  type: string
  app?: string
  raw?: string
  at: number
}

export interface SavedTemplate {
  id: string
  name: string
  template: string
}

const KEY_SETTINGS = "schemeBatch.settings"
const KEY_HISTORY = "schemeBatch.history"
const KEY_TEMPLATES = "schemeBatch.templates"
const KEY_ICON_LIBS = "schemeBatch.iconLibraries"
const KEY_RAW = "schemeBatch.historyRaw"
const KEY_DONE_LEGACY = "schemeBatch.done"

const MAX_RECORDS = 500

export function loadSettings(): Settings {
  try {
    const stored = Storage.get<Partial<Settings>>(KEY_SETTINGS)
    if (stored && typeof stored === "object") {
      const merged: Settings = { ...DEFAULT_SETTINGS, ...stored }
      merged.skipDone = merged.skipDone !== false
      merged.notify = merged.notify !== false
      merged.buttonFX = merged.buttonFX !== false
      if (typeof merged.customTemplate !== "string") merged.customTemplate = ""
      if (typeof merged.activeTemplateId !== "string") merged.activeTemplateId = undefined
      if (!isAppId(merged.appId)) merged.appId = DEFAULT_SETTINGS.appId
      if (SORT_KEYS.indexOf(merged.librarySort) < 0) merged.librarySort = DEFAULT_SETTINGS.librarySort
      merged.librarySortDesc = merged.librarySortDesc === true
      merged.tagOrder = Array.isArray(merged.tagOrder)
        ? merged.tagOrder.filter(item => typeof item === "string" && !!item.trim()).slice(0, 100)
        : []
      return merged
    }
  } catch (error) {
    console.log("loadSettings failed", error)
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: Settings): boolean {
  try {
    return Storage.set(KEY_SETTINGS, {
      skipDone: settings.skipDone,
      notify: settings.notify,
      buttonFX: settings.buttonFX,
      appId: settings.appId,
      customTemplate: settings.customTemplate,
      activeTemplateId: settings.activeTemplateId,
      librarySort: settings.librarySort,
      librarySortDesc: settings.librarySortDesc,
      tagOrder: Array.isArray(settings.tagOrder) ? settings.tagOrder : [],
    })
  } catch (error) {
    console.log("saveSettings failed", error)
    return false
  }
}

function readRawMap(): Record<string, string> {
  try {
    const text = Keychain.get(KEY_RAW)
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
    console.log("readRawMap failed", error)
    return {}
  }
}

function writeRawMap(raws: Record<string, string>): boolean {
  try {
    if (Object.keys(raws).length === 0) return Keychain.remove(KEY_RAW)
    return Keychain.set(KEY_RAW, JSON.stringify(raws), { accessibility: "first_unlock_this_device" })
  } catch (error) {
    console.log("writeRawMap failed", error)
    return false
  }
}

export function loadHistory(): HistoryRecord[] {
  let stored: unknown = null
  try {
    stored = Storage.get<HistoryRecord[]>(KEY_HISTORY)
    if (!Array.isArray(stored)) {
      const legacy = Storage.get<Record<string, number>>(KEY_DONE_LEGACY)
      if (legacy && typeof legacy === "object") {
        return Object.keys(legacy).map(id => ({
          id,
          title: "",
          host: "",
          account: "",
          type: "",
          at: legacy[id],
        }))
      }
      return []
    }
  } catch (error) {
    console.log("loadHistory failed", error)
    return []
  }

  const raws = readRawMap()
  const records = (stored as HistoryRecord[])
    .filter(record => record && typeof record.id === "string")
    .map(record => {
      const raw = record.raw || raws[record.id]
      return raw ? { ...record, raw } : record
    })

  const moved = records.some(record => !!record.raw && !raws[record.id])
  if (moved) saveHistory(records)
  return records
}

export function saveHistory(records: HistoryRecord[]): boolean {
  try {
    const kept = records.slice(0, MAX_RECORDS)
    const raws: Record<string, string> = {}
    for (const record of kept) {
      if (record.raw) raws[record.id] = record.raw
    }
    const rawSaved = writeRawMap(raws)
    const meta: HistoryRecord[] = kept.map(record => {
      const copy: HistoryRecord = { ...record }
      if (rawSaved) delete copy.raw
      return copy
    })
    return Storage.set(KEY_HISTORY, meta) && rawSaved
  } catch (error) {
    console.log("saveHistory failed", error)
    return false
  }
}

export function loadTemplates(): SavedTemplate[] {
  try {
    const stored = Storage.get<SavedTemplate[]>(KEY_TEMPLATES)
    if (Array.isArray(stored)) {
      return stored.filter(item => item && typeof item.template === "string")
    }
  } catch (error) {
    console.log("loadTemplates failed", error)
  }
  return []
}

export function saveTemplates(templates: SavedTemplate[]): boolean {
  try {
    return Storage.set(KEY_TEMPLATES, templates.slice(0, 50))
  } catch (error) {
    console.log("saveTemplates failed", error)
    return false
  }
}

export interface SavedIconLibrary {
  id: string
  url: string
  name: string
  count: number
  addedAt: number
}

export function loadIconLibraries(): SavedIconLibrary[] {
  try {
    const stored = Storage.get<SavedIconLibrary[]>(KEY_ICON_LIBS)
    if (!Array.isArray(stored)) return []
    const out: SavedIconLibrary[] = []
    for (const item of stored) {
      if (!item || typeof item.url !== "string" || !item.url.trim()) continue
      out.push({
        id: String(item.id || item.url),
        url: item.url.trim(),
        name: typeof item.name === "string" ? item.name : "",
        count: typeof item.count === "number" ? item.count : 0,
        addedAt: typeof item.addedAt === "number" ? item.addedAt : 0,
      })
    }
    return out
  } catch (error) {
    console.log("loadIconLibraries failed", error)
    return []
  }
}

export function saveIconLibraries(list: SavedIconLibrary[]): boolean {
  try {
    return Storage.set(KEY_ICON_LIBS, list.slice(0, 20))
  } catch (error) {
    console.log("saveIconLibraries failed", error)
    return false
  }
}

export function formatRecordTime(at: number): string {  const date = new Date(at)
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getMinutes()
  )}`
}
