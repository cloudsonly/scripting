/** 设置与导入记录的本地持久化（Storage 为全局对象，无需 import）。 */

import type { AppId } from "./apps"
import { isAppId } from "./apps"

export interface Settings {
  /** 是否跳过曾经成功打开过的链接 */
  skipDone: boolean
  /** 结束后是否发送本地通知 */
  notify: boolean
  /** 胶囊按钮的按压缩放与点击震动 */
  buttonFX: boolean
  /** 导入到哪个 App */
  appId: AppId
  /** 「自定URL Scheme」的正文（appId 为 custom 时使用） */
  customTemplate: string
  /** 当前用的已保存 URL Scheme id；为空 = 「自定URL Scheme」新建的未命名方案 */
  activeTemplateId?: string
}

export const DEFAULT_SETTINGS: Settings = {
  skipDone: true,
  notify: true,
  buttonFX: true,
  appId: "rex",
  customTemplate: "",
}

/** 一条导入记录 */
export interface HistoryRecord {
  id: string
  title: string
  host: string
  account: string
  type: string
  /** 导入到哪个 App（如 Rex；旧记录为空） */
  app?: string
  /** 完整导入链接（用于从记录重新导入 / 编辑；含密码，仅存本机 Storage）。旧记录可能没有。 */
  raw?: string
  /** 时间戳（毫秒） */
  at: number
}

/** 一条已保存的自定 URL Scheme */
export interface SavedTemplate {
  id: string
  name: string
  template: string
}

const KEY_SETTINGS = "schemeBatch.settings"
const KEY_HISTORY = "schemeBatch.history"
const KEY_TEMPLATES = "schemeBatch.templates"
/** 旧版本只存 id → 时间戳；仅用于迁移 */
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
      return merged
    }
  } catch (error) {
    console.log("loadSettings failed", error)
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: Settings): void {
  try {
    Storage.set(KEY_SETTINGS, {
      skipDone: settings.skipDone,
      notify: settings.notify,
      buttonFX: settings.buttonFX,
      appId: settings.appId,
      customTemplate: settings.customTemplate,
      activeTemplateId: settings.activeTemplateId,
    })
  } catch (error) {
    console.log("saveSettings failed", error)
  }
}

export function loadHistory(): HistoryRecord[] {
  try {
    const stored = Storage.get<HistoryRecord[]>(KEY_HISTORY)
    if (Array.isArray(stored)) {
      return stored.filter(record => record && typeof record.id === "string")
    }
    // 迁移旧版记录（只有 id 与时间）
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
  } catch (error) {
    console.log("loadHistory failed", error)
  }
  return []
}

export function saveHistory(records: HistoryRecord[]): void {
  try {
    Storage.set(KEY_HISTORY, records.slice(0, MAX_RECORDS))
  } catch (error) {
    console.log("saveHistory failed", error)
  }
}

/** 已保存的自定 URL Scheme 列表 */
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

export function saveTemplates(templates: SavedTemplate[]): void {
  try {
    Storage.set(KEY_TEMPLATES, templates.slice(0, 50))
  } catch (error) {
    console.log("saveTemplates failed", error)
  }
}

export function formatRecordTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}
