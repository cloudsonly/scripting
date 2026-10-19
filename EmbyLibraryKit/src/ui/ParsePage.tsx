import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  Notification,
  Picker,
  ProgressView,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useRef,
  useState,
} from "scripting"
import type { AppId, AppPreset } from "../apps"
import { APP_PRESETS, DEFAULT_CUSTOM_TEMPLATE, appPreset, appNameForRaw, buildURL } from "../apps"
import type { BatchItem } from "../batch"
import { runBatch, summarizeBatch } from "../batch"
import { requestContinue, waitForReturn } from "../foreground"
import type { SchemeEntry } from "../parse"
import { entryBadges, entryLabel, entrySubtitle, maskSecrets, parseEntries, parseRaw } from "../parse"
import type { SubscriptionServer } from "../subscription"
import { parseSubscriptionJSON, serverFromEntry, serversToEntries, splitAddress } from "../subscription"
import { parseNotice } from "../notice"
import type { LibraryServer } from "../library"
import { fromSubscriptionServer, newServerId } from "../library"
import { DIFF_FIELD_LABELS, applyChosenFields, diffServerFields, findServerIndex } from "../library"
import type { DiffField } from "../library"
import type { HistoryRecord, SavedIconLibrary, SavedTemplate, Settings } from "../store"
import HistoryView from "./HistoryView"
import EntryEditorView from "./EntryEditorView"
import TextEditorView from "./TextEditorView"
import { PillButton, setButtonEffects } from "./PillButton"
import { ACCENT, ACCENT_TEXT, DANGER, SUCCESS, SUCCESS_TEXT, WARNING, WARNING_TEXT } from "./tokens"


function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeWarning(ok: boolean): string {
  return ok ? "" : "未能写入本机存储，重启后本次改动将丢失；请对同一内容重试一次。"
}

export function EntryRow(props: {
  entry: SchemeEntry
  selected: boolean
  imported: boolean
  disabled: boolean
  onToggle: () => void
  onEdit: () => void
  onOpen: () => void
}) {
  const entry = props.entry
  const badges = entry.valid ? entryBadges(entry, props.imported, entry.duplicate) : []
  const tint = !entry.valid ? WARNING : props.imported ? SUCCESS : "secondaryLabel"
  const swipeActions = [
    <Button key="edit" title="编辑参数" tint={ACCENT} action={props.disabled ? () => {} : props.onEdit} />,
    ...(entry.valid
      ? [<Button key="open" title="导入" tint={SUCCESS} action={props.disabled ? () => {} : props.onOpen} />]
      : []),
  ]
  return (
    <HStack
      spacing={12}
      opacity={props.disabled ? 0.5 : 1}
      trailingSwipeActions={{ allowsFullSwipe: false, actions: swipeActions }}
    >
      <Image
        systemName={props.selected ? "checkmark.circle.fill" : "circle"}
        font={20}
        foregroundStyle={props.selected ? ACCENT_TEXT : "tertiaryLabel"}
        onTapGesture={props.disabled ? undefined : props.onToggle}
      />
      <VStack
        alignment="leading"
        spacing={2}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        onTapGesture={props.disabled ? undefined : props.onToggle}
      >
        <Text bold={true} lineLimit={1} multilineTextAlignment="leading">
          {entry.valid ? entryLabel(entry) : "无法导入的链接"}
        </Text>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          truncationMode="middle"
          multilineTextAlignment="leading"
        >
          {entry.valid ? entrySubtitle(entry) : entry.issues.join(" · ")}
        </Text>
        {badges.length > 0 ? (
          <Text font="caption2" foregroundStyle={tint} lineLimit={1} multilineTextAlignment="leading">
            {badges.join(" · ")}
          </Text>
        ) : null}
        {!entry.valid ? (
          <Text
            font="caption2"
            foregroundStyle="secondaryLabel"
            lineLimit={1}
            truncationMode="middle"
            multilineTextAlignment="leading"
          >
            {/* 无效行也常常是残缺的导入链接，里面带密码 */}
            {maskSecrets(entry.raw)}
          </Text>
        ) : null}
      </VStack>
    </HStack>
  )
}

const UPDATABLE_FIELDS: DiffField[] = ["type", "password", "address", "lines", "remark"]

interface OriginInfo {
  kind: "clipboard" | "file" | "manual"
  detail: string
}

function serverKeyOf(host: string, port: string, account: string): string {
  return `${host.toLowerCase()}|${port}|${account}`
}

function entryServerKey(entry: SchemeEntry): string {
  return serverKeyOf(entry.host, entry.port, entry.username)
}

function serverKey(server: SubscriptionServer): string {
  const split = splitAddress(server.address)
  return serverKeyOf(split.host, split.port, server.account)
}

export default function ParsePage(props: {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => Settings
  history: HistoryRecord[]
  writeHistory: (records: HistoryRecord[]) => boolean
  templates: SavedTemplate[]
  iconLibraries: SavedIconLibrary[]
  libraryServers: LibraryServer[]
  replaceLibrary: (servers: LibraryServer[]) => boolean
  initialText?: string
}) {
  const dismiss = Navigation.useDismiss()
  const settings = props.settings
  const templates = props.templates
  const history = props.history

  const [source, setSource] = useState("")
  const [entries, setEntries] = useState<SchemeEntry[]>([])
  const [invalidLines, setInvalidLines] = useState<string[]>([])
  const [servers, setServers] = useState<SubscriptionServer[]>([])
  const [serverLineCount, setServerLineCount] = useState(0)
  const [origin, setOrigin] = useState<OriginInfo | null>(null)
  const [manuallyEdited, setManuallyEdited] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [status, setStatus] = useState<"idle" | "running">("idle")
  const [waiting, setWaiting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" })
  const [message, setMessage] = useState("")
  const [showEditor, setShowEditor] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFullEditor, setShowFullEditor] = useState(false)

  const runningRef = useRef(false)
  const settingsRef = useRef(settings)
  const historyRef = useRef(history)
  const serversRef = useRef(servers)
  const entryMapRef = useRef(new Map<string, SchemeEntry>())
  const persistFailedRef = useRef(false)
  settingsRef.current = settings
  historyRef.current = history
  serversRef.current = servers
  entryMapRef.current = new Map(entries.map(entry => [entry.id, entry]))

  useEffect(() => {
    setButtonEffects(settings.buttonFX)
    if (settings.appId === "custom" && !templates.some(item => item.id === settings.activeTemplateId)) {
      updateSettings({ appId: APP_PRESETS[0].id, activeTemplateId: undefined })
    }
    const seed = props.initialText ?? Script.queryParameters?.text
    if (typeof seed === "string" && seed.trim().length > 0) {
      applyText(seed, { kind: "manual", detail: "" })
    }
  }, [])

  const preset = appPreset(settings.appId)
  const customTemplate = settings.customTemplate || DEFAULT_CUSTOM_TEMPLATE
  const importedRaws = new Set(history.flatMap(record => (record.raw ? [record.raw] : [])))
  const legacyImportedIds = new Set(history.flatMap(record => (record.raw ? [] : [record.id])))
  const isImported = (entry: SchemeEntry) => importedRaws.has(entry.raw) || legacyImportedIds.has(entry.id)
  const validEntries = entries.filter(entry => entry.valid)
  const selectableEntries = validEntries.filter(entry => !entry.duplicate)
  const selectedEntries = entries.filter(entry => selected.includes(entry.id))
  const importableSelected = selectedEntries.filter(entry => entry.valid)
  const importedCount = entries.filter(entry => isImported(entry)).length

  function updateSettings(patch: Partial<Settings>) {
    return props.updateSettings(patch)
  }

  function writeHistory(records: HistoryRecord[]) {
    historyRef.current = records
    const ok = props.writeHistory(records)
    if (!ok) persistFailedRef.current = true
    return ok
  }

  function buildFor(server: SubscriptionServer, target: AppPreset, template: string): string {
    return buildURL(server, target, template)
  }

  function originLabel(): string {
    if (!origin) return ""
    const base =
      origin.kind === "clipboard" ? "剪贴板" : origin.kind === "file" ? `文件（${origin.detail}）` : "手动输入"
    if (manuallyEdited && origin.kind !== "manual") return `${base} + 手动输入`
    return base
  }

  function applyServers(
    list: SubscriptionServer[],
    target: AppPreset,
    template: string,
    from: OriginInfo,
    kindLabel = "",
    keepSelection = false
  ) {
    const keepKeys = new Set(
      keepSelection
        ? entries.filter(entry => selected.includes(entry.id) && entry.valid).map(entry => entryServerKey(entry))
        : []
    )
    const converted = serversToEntries(list, server => buildFor(server, target, template))
    const rows = converted.entries
    const defaults = rows.filter(entry => entry.valid && !entry.duplicate).map(entry => entry.id)
    const kept = rows
      .filter(entry => entry.valid && !entry.duplicate && keepKeys.has(entryServerKey(entry)))
      .map(entry => entry.id)
    const finalIds = keepSelection ? kept : defaults
    setServers(list)
    setServerLineCount(converted.lineCount)
    setEntries(rows)
    setInvalidLines([])
    setSelected(finalIds)
    setOrigin(from)
    setProgress({ done: 0, total: 0, current: "" })
    setMessage(
      `${kindLabel}已生成 ${rows.length} 条 ${target.name} 导入链接，已选中 ${finalIds.length} 条` +
        (converted.lineCount > 0 ? `（含 ${converted.lineCount} 条备用线路）` : "")
    )
  }

  function applyText(text: string, from: OriginInfo) {
    const target = appPreset(settingsRef.current.appId)
    const template = settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE
    if (from.kind === "manual") setManuallyEdited(true)
    const parsed = parseSubscriptionJSON(text)
    if (parsed) {
      setSource(text)
      applyServers(parsed, target, template, from, "订阅 JSON：")
      return
    }

    const notice = parseNotice(text)
    if (notice) {
      setSource(text)
      applyServers(
        notice.items,
        target,
        template,
        from,
        notice.items.length > 1 ? `识别到 ${notice.items.length} 条开通通知。` : "识别到开通通知。"
      )
      return
    }

    const result = parseEntries(text)
    const ids = result.entries.filter(entry => entry.valid && !entry.duplicate).map(entry => entry.id)
    setSource(text)
    setServers(result.entries.filter(entry => entry.valid).map(serverFromEntry))
    setServerLineCount(0)
    setEntries(result.entries)
    setInvalidLines(result.invalidLines)
    setSelected(ids)
    setOrigin(from)
    setProgress({ done: 0, total: 0, current: "" })
    const parts = [`识别到 ${result.entries.length} 条链接，已选中 ${ids.length} 条`]
    if (result.invalidLines.length > 0) parts.push(`${result.invalidLines.length} 行未包含链接`)
    setMessage(parts.join(" · "))
  }

  function selectedServersForLibrary(): SubscriptionServer[] {
    const byKey = new Map<string, SubscriptionServer>()
    for (const server of serversRef.current) {
      const key = serverKey(server)
      if (!byKey.has(key)) byKey.set(key, server)
    }
    const list: SubscriptionServer[] = []
    const seen = new Set<string>()
    for (const entry of importableSelected) {
      const key = entryServerKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      list.push(byKey.get(key) || serverFromEntry(entry))
    }
    return list
  }

  const libraryCount = new Set(importableSelected.map(entryServerKey)).size

  async function addToLibraryNow() {
    const chosen = selectedServersForLibrary()
    if (chosen.length === 0) {
      setMessage("先在待导入列表勾选条目")
      return
    }
    const now = Date.now()
    const seeds = chosen.map(server =>
      fromSubscriptionServer(server, {
        id: newServerId(),
      })
    )
    const pool = props.libraryServers.slice()
    const conflicts: Array<{ at: number; incoming: LibraryServer; fields: DiffField[] }> = []
    let added = 0
    let identical = 0
    for (const seed of seeds) {
      const at = findServerIndex(pool, seed)
      if (at < 0) {
        pool.push({ ...seed, createdAt: now, updatedAt: now })
        added++
        continue
      }
      const fields = diffServerFields(pool[at], seed).filter(field => UPDATABLE_FIELDS.indexOf(field) >= 0)
      if (fields.length === 0) {
        identical++
        continue
      }
      conflicts.push({ at, incoming: seed, fields })
    }

    if (conflicts.length === 0) {
      finishLibraryWrite(pool, `已新增 ${added} 台 ${identical} 台与库里一致未改动`)
      return
    }

    const plan = await Dialog.actionSheet({
      title: `新增 ${added} 台 需确认 ${conflicts.length} 台`,
      message: "同线路或同名的按已存在处理 只改你选的项",
      actions: [
        { label: "逐项确认" },
        { label: "全部更新" },
        { label: "只整理线路" },
        { label: "只更新密码" },
        { label: "跳过", destructive: true },
      ],
      cancelButton: true,
    })
    if (plan === null) return

    if (plan === 0) {
      for (const conflict of conflicts) {
        const labels = conflict.fields.map(field => DIFF_FIELD_LABELS[field])
        const actions: { label: string; destructive?: boolean }[] = [{ label: `全都要（${labels.length} 项）` }]
        for (const field of conflict.fields) actions.push({ label: DIFF_FIELD_LABELS[field] })
        actions.push({ label: "只更新密码" })
        actions.push({ label: "跳过这一台", destructive: true })
        const pickedName = conflict.incoming.name || conflict.incoming.address
        const choice = await Dialog.actionSheet({
          title: `更新 ${pickedName}`,
          message: `不同项 ${labels.join(" ")}`,
          actions,
          cancelButton: true,
        })
        if (choice === null || choice === actions.length - 1) continue
        const fields: DiffField[] =
          choice === 0 ? conflict.fields.slice() : choice === actions.length - 2 ? ["password"] : [conflict.fields[choice - 1]]
        pool[conflict.at] = applyChosenFields(pool[conflict.at], conflict.incoming, fields, Date.now())
      }
      finishLibraryWrite(pool, `已新增 ${added} 台 逐台更新 ${conflicts.length} 台`)
      return
    }
    if (plan === 4) {
      finishLibraryWrite(pool, `已新增 ${added} 台 跳过 ${conflicts.length} 台`)
      return
    }
    for (const conflict of conflicts) {
      const fields: DiffField[] = plan === 1 ? conflict.fields.slice() : plan === 2 ? ["lines"] : ["password"]
      pool[conflict.at] = applyChosenFields(pool[conflict.at], conflict.incoming, fields, Date.now())
    }
    const how = plan === 1 ? "全部不同项" : plan === 2 ? "只整理线路" : "只更新密码"
    finishLibraryWrite(pool, `已新增 ${added} 台 更新 ${conflicts.length} 台 ${how}`)
  }

  function finishLibraryWrite(next: LibraryServer[], note: string) {
    const ok = props.replaceLibrary(next)
    setMessage(ok ? note : note + " 未写入本机存储")
  }

  const appOptions: Array<{ tag: string; label: string }> = [
    ...APP_PRESETS.filter(item => item.id !== "custom").map(item => ({ tag: item.id as string, label: item.name })),
    ...templates.map(item => ({ tag: `custom:${item.id}`, label: item.name || "未命名方案" })),
  ]

  const pickerValue =
    settings.appId !== "custom"
      ? (settings.appId as string)
      : templates.some(item => item.id === settings.activeTemplateId)
        ? `custom:${settings.activeTemplateId}`
        : (APP_PRESETS[0].id as string)

  function applyTarget(target: AppPreset, template: string, note = "") {
    if (note) setMessage(note)
    if (serversRef.current.length === 0) return
    applyServers(
      serversRef.current,
      target,
      template,
      origin ?? { kind: "manual", detail: "" },
      "",
      true
    )
  }

  function changeAppValue(value: string) {
    if (value.startsWith("custom:")) {
      const id = value.slice("custom:".length)
      const saved = templates.find(item => item.id === id)
      if (!saved) return
      const template = saved.template.trim() || DEFAULT_CUSTOM_TEMPLATE
      updateSettings({ appId: "custom", customTemplate: template, activeTemplateId: id })
      applyTarget(appPreset("custom"), template, `已切换到 URL Scheme「${saved.name || "未命名方案"}」。`)
      return
    }
    const next = updateSettings({ appId: value as AppId, activeTemplateId: undefined })
    applyTarget(appPreset(value as AppId), next.customTemplate || DEFAULT_CUSTOM_TEMPLATE, "")
  }

  function appOfRaw(raw: string): string {
    return appNameForRaw(raw, appPreset(settingsRef.current.appId).name)
  }

  function addRecord(entry: SchemeEntry) {
    const record: HistoryRecord = {
      id: entry.id,
      title: entry.title,
      host: entry.host ? `${entry.host}${entry.port ? ":" + entry.port : ""}` : entry.scheme,
      account: entry.username,
      type: entry.type || entry.scheme,
      app: appOfRaw(entry.raw),
      raw: entry.raw,
      at: Date.now(),
    }
    writeHistory([record, ...historyRef.current.filter(item => item.raw !== record.raw)])
  }

  function clearHistory() {
    setMessage(writeWarning(writeHistory([])) + "已清除全部导入记录 含钥匙串里的链接")
  }

  function deleteRecords(ids: string[]) {
    const removed = new Set(ids)
    const next = historyRef.current.filter(record => !removed.has(record.id))
    setMessage(writeWarning(writeHistory(next)) + `已删除 ${ids.length} 条记录`)
  }

  function openRecordEditor(record: HistoryRecord) {
    if (!record.raw) {
      setMessage("该记录没有导入链接 无法编辑")
      return
    }
    const recordPreset = APP_PRESETS.find(item => item.name === record.app) ?? preset
    Navigation.present<SubscriptionServer>({
      element: (
        <EntryEditorView
          entry={parseRaw(record.raw)}
          title="编辑记录参数"
          appName={recordPreset.name}
          buildPreview={server => buildFor(server, recordPreset, customTemplate)}
          iconLibraries={props.iconLibraries}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (!result) return
        const raw = buildFor(result, recordPreset, customTemplate)
        const entry = parseRaw(raw)
        const updated: HistoryRecord = {
          ...record,
          id: entry.id,
          raw,
          title: entry.title,
          host: entry.host ? `${entry.host}${entry.port ? ":" + entry.port : ""}` : entry.scheme,
          account: entry.username,
          type: entry.type || entry.scheme,
          app: recordPreset.name,
        }
        const next = historyRef.current.map(item => (item.id === record.id ? updated : item))
        setMessage(
          writeWarning(writeHistory(next)) + `已更新记录「${updated.title || updated.host}」。`
        )
      })
      .catch(error => setMessage(`编辑记录失败 ${errorText(error)}`))
  }

  function importRecords(picked: HistoryRecord[]) {
    const raws = picked.map(record => record.raw).filter((raw): raw is string => !!raw)
    if (raws.length === 0) {
      setMessage("旧记录没有导入链接 无法重新导入")
      return
    }
    const usable = raws.map(raw => parseRaw(raw)).filter(entry => entry.valid)
    if (usable.length === 0) {
      setMessage("所选记录没有可导入的链接")
      return
    }
    setShowHistory(false)
    startBatch(usable, { ignoreSkipDone: true })
  }

  function clearInput() {
    setSource("")
    setEntries([])
    setInvalidLines([])
    setServers([])
    serversRef.current = []
    setServerLineCount(0)
    setSelected([])
    setOrigin(null)
    setManuallyEdited(false)
    setProgress({ done: 0, total: 0, current: "" })
    setMessage("已清空输入与识别结果")
  }

  function openEntryEditor(entry: SchemeEntry) {
    Navigation.present<SubscriptionServer>({
      element: (
        <EntryEditorView
          entry={entry}
          title="编辑参数"
          appName={preset.name}
          buildPreview={server => buildFor(server, preset, customTemplate)}
          iconLibraries={props.iconLibraries}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (result) applyEntryEdit(entry, result)
      })
      .catch(error => setMessage(`编辑失败 ${errorText(error)}`))
  }

  function applyEntryEdit(target: SchemeEntry, server: SubscriptionServer) {
    const raw = buildFor(server, preset, customTemplate)
    const updated = parseRaw(raw)
    const nextEntries = entries.map(item => (item.id === target.id ? updated : item))
    const nextSelected = selected.map(id => (id === target.id ? updated.id : id))
    const nextServers = nextEntries.filter(item => item.valid).map(serverFromEntry)
    setEntries(nextEntries)
    setSelected(nextSelected)
    setServers(nextServers)
    serversRef.current = nextServers
    setManuallyEdited(true)
    setMessage(
      updated.valid
        ? `已更新「${entryLabel(updated)}」的参数。`
        : `已更新，但仍然缺少必要字段：${updated.issues.join("、")}`
    )
  }

  async function importFromClipboard() {
    try {
      let text = await Pasteboard.getString()
      if (!text || !text.trim()) {
        const urls = await Pasteboard.getURLs()
        if (urls && urls.length > 0) text = urls.join("\n")
        else {
          const url = await Pasteboard.getURL()
          if (url) text = url
        }
      }
      if (!text || !text.trim()) {
        setMessage("剪贴板没有可用文本 请先复制链接")
        return
      }
      applyText(text, { kind: "clipboard", detail: "" })
    } catch (error) {
      setMessage(`读取剪贴板失败 ${errorText(error)}`)
    }
  }

  async function importFromFile() {
    try {
      const paths = await DocumentPicker.pickFiles({ allowsMultipleSelection: true })
      if (!paths || paths.length === 0) return
      const texts: string[] = []
      for (const path of paths) {
        try {
          texts.push(await FileManager.readAsString(path))
        } catch (error) {
          setMessage(`读取文件失败 ${errorText(error)}`)
        }
      }
      if (texts.length === 0) return
      const names = paths.map(path => path.split("/").pop() || path)
      applyText(texts.join("\n"), { kind: "file", detail: names.length === 1 ? names[0] : `${names.length} 个文件` })
    } catch (error) {
      setMessage(`导入文本文件失败 ${errorText(error)}`)
    }
  }

  async function openLink(raw: string, id: string, known?: SchemeEntry): Promise<boolean> {
    try {
      const opened = await Safari.openURL(raw)
      if (opened) {
        const entry = known ?? entryMapRef.current.get(id)
        if (entry) addRecord(entry)
      }
      return opened
    } catch (error) {
      console.log("openURL failed", raw, error)
      return false
    }
  }

  async function openOne(entry: SchemeEntry) {
    if (!entry.valid) {
      setMessage(`链接缺少服务器地址 ${entry.raw}`)
      return
    }
    const opened = await openLink(entry.raw, entry.id)
    setMessage(
      opened ? `已打开 ${entryLabel(entry)}，请在 ${preset.name} 中确认导入。` : `无法打开链接：${entry.raw}`
    )
  }

  function stopBatch() {
    runningRef.current = false
    requestContinue()
    setWaiting(false)
    setStatus("idle")
    setMessage("正在停止")
  }

  async function startBatch(queueOverride?: SchemeEntry[], options?: { ignoreSkipDone?: boolean }) {
    const queue = queueOverride ?? entries.filter(entry => selected.includes(entry.id) && entry.valid)
    if (queue.length === 0) {
      setMessage("所选条目没有可导入的链接")
      return
    }
    const skipDone = settingsRef.current.skipDone && !options?.ignoreSkipDone
    const pending = skipDone ? queue.filter(entry => !isImported(entry)) : queue
    if (pending.length === 0) {
      setMessage(`${queue.length} 条都已导入过 可在设置里关闭跳过已导入`)
      return
    }

    const items: BatchItem[] = pending.map(entry => ({
      id: entry.id,
      raw: entry.raw,
      label: entryLabel(entry),
    }))
    const byId = new Map(pending.map(entry => [entry.id, entry]))
    runningRef.current = true
    setStatus("running")
    setWaiting(false)
    setProgress({ done: 0, total: items.length, current: "" })

    const outcome = await runBatch(
      items,
      {
        isCancelled: () => !runningRef.current,
        onProgress: (done, total, current) => {
          setProgress({ done, total, current })
        },
        between: async (_item, _index, opened) => {
          if (!opened) return
          setWaiting(true)
          await waitForReturn(() => !runningRef.current)
          setWaiting(false)
        },
      },
      item => openLink(item.raw, item.id, byId.get(item.id))
    )

    setWaiting(false)
    runningRef.current = false
    setStatus("idle")

    const summary = summarizeBatch(outcome)
    setMessage(
      persistFailedRef.current
        ? `${summary}；其中部分记录未写入本机存储（含密码的链接存于钥匙串），「跳过已导入过的链接」可能不准确。`
        : summary
    )
    persistFailedRef.current = false

    if (settingsRef.current.notify) {
      try {
        await Notification.schedule({
          title: `${preset.name} 批量导入`,
          body: outcome.failed > 0 ? `${summary}。失败：${outcome.failures.slice(0, 3).join("、")}` : summary,
          silent: false,
        })
      } catch (error) {
        console.log("notify failed", error)
      }
    }
  }

  return (
    <>
      {showFullEditor ? (
        <TextEditorView
          text={source}
          onParse={text => {
            applyText(text, { kind: "manual", detail: "" })
            setShowFullEditor(false)
          }}
          onCancel={() => setShowFullEditor(false)}
        />
      ) : showHistory ? (
        <HistoryView
          records={history}
          onBack={() => setShowHistory(false)}
          onClear={clearHistory}
          onDelete={deleteRecords}
          onEdit={openRecordEditor}
          onImport={importRecords}
        />
      ) : (
        <List
          navigationTitle="解析导入"
          navigationBarTitleDisplayMode="inline"
          toolbar={{
            topBarLeading: <Button title="" systemImage="xmark" action={dismiss} />,
            topBarTrailing: [
              <Button
                key="history"
                title=""
                systemImage="clock.arrow.circlepath"
                action={() => setShowHistory(true)}
              />,
              <Button key="reset" title="" systemImage="arrow.counterclockwise" action={clearInput} />,
            ],
          }}
        >
          <Section header={<Text>来源</Text>}>
            <HStack spacing={10}>
              <PillButton
                title="读取剪贴板"
                action={() => importFromClipboard().catch(error => setMessage(`读取剪贴板失败 ${errorText(error)}`))}
              />
              <PillButton
                title="导入数据文件"
                color={SUCCESS}
                action={() => importFromFile().catch(error => setMessage(`导入文件失败 ${errorText(error)}`))}
              />
            </HStack>
            <Toggle title="手动输入 / 查看文本" value={showEditor} onChanged={setShowEditor} />
            {showEditor ? (
              <PillButton title="解析文本" action={() => applyText(source, { kind: "manual", detail: "" })} />
            ) : null}
            {showEditor ? (
              <HStack spacing={10}>
                <TextField
                  title=""
                  prompt="请粘贴导入链接或订阅 JSON"
                  value={source}
                  onChanged={setSource}
                  axis="vertical"
                  lineLimit={{ min: 4, max: 8 }}
                  frame={{ maxWidth: "infinity" }}
                />
                <Image
                  systemName="arrow.up.left.and.arrow.down.right"
                  font={20}
                  foregroundStyle={ACCENT_TEXT}
                  onTapGesture={() => setShowFullEditor(true)}
                />
              </HStack>
            ) : null}
            {message ? (
              <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
                {message}
              </Text>
            ) : null}
          </Section>

          <Section header={<Text>导入</Text>} footer={<Text>自定方案在设置 → 数据 → 自定 URL Scheme 里新建或修改。</Text>}>
            <Picker title="播放器" value={pickerValue} onChanged={(value: string) => changeAppValue(value)}>
              {appOptions.map(item => (
                <Text key={item.tag} tag={item.tag}>
                  {item.label}
                </Text>
              ))}
            </Picker>
          </Section>

          {entries.length > 0 ? (
            <Section header={<Text>识别结果</Text>} footer={origin ? <Text>来源：{originLabel()}</Text> : undefined}>
              <HStack>
                <Text>链接总数</Text>
                <Spacer />
                <Text foregroundStyle="secondaryLabel">{entries.length}</Text>
              </HStack>
              <HStack>
                <Text>可导入</Text>
                <Spacer />
                <Text foregroundStyle={SUCCESS_TEXT}>{validEntries.length}</Text>
              </HStack>
              {serverLineCount > 0 ? (
                <HStack>
                  <Text>备用线路</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">{`${serverLineCount} 条`}</Text>
                </HStack>
              ) : null}
              <HStack>
                <Text>重复账号</Text>
                <Spacer />
                <Text foregroundStyle={WARNING_TEXT}>{validEntries.length - selectableEntries.length}</Text>
              </HStack>
              <HStack>
                <Text>已导入过</Text>
                <Spacer />
                <Text foregroundStyle="secondaryLabel">{importedCount}</Text>
              </HStack>
              <HStack>
                <Text>已选中</Text>
                <Spacer />
                <Text foregroundStyle={ACCENT_TEXT}>{selectedEntries.length}</Text>
              </HStack>
            </Section>
          ) : null}

          {entries.length > 0 ? (
            <Section header={<Text>批量导入</Text>}>
              {status === "running" ? (
                <PillButton title="停止" color={DANGER} action={stopBatch} />
              ) : (
                <PillButton
                  title={`开始导入（${importableSelected.length}）`}
                  disabled={importableSelected.length === 0}
                  action={() => startBatch().catch(error => setMessage(`导入失败 ${errorText(error)}`))}
                />
              )}
              <PillButton
                title={`添加到媒体库（${libraryCount}）`}
                color={SUCCESS}
                disabled={libraryCount === 0 || status === "running"}
                action={() => addToLibraryNow().catch(error => setMessage(`添加到媒体库失败 ${errorText(error)}`))}
              />
              {status === "running" && waiting ? (
                <PillButton title="立即下一条" action={() => requestContinue()} />
              ) : null}
              {progress.total > 0 ? (
                <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
                  <ProgressView value={progress.done} total={progress.total} progressViewStyle="linear" />
                  <HStack>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {`${progress.done} / ${progress.total}`}
                    </Text>
                    <Spacer />
                    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {waiting ? "等待你回到本页…（最多 10 秒）" : progress.current}
                    </Text>
                  </HStack>
                </VStack>
              ) : null}
            </Section>
          ) : null}

          {entries.length > 0 ? (
            <Section header={<Text>{`待导入列表（${selectedEntries.length}/${entries.length}）`}</Text>}>
              <HStack spacing={10}>
                <PillButton
                  title={`全选（${selectableEntries.length}）`}
                  action={() => setSelected(selectableEntries.map(entry => entry.id))}
                />
                <PillButton
                  title="反选"
                  action={() =>
                    setSelected(selectableEntries.filter(entry => !selected.includes(entry.id)).map(entry => entry.id))
                  }
                />
              </HStack>
              {entries.map(entry => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  selected={selected.includes(entry.id)}
                  imported={isImported(entry)}
                  disabled={status === "running"}
                  onToggle={() =>
                    setSelected(current =>
                      current.includes(entry.id) ? current.filter(item => item !== entry.id) : [...current, entry.id]
                    )
                  }
                  onEdit={() => openEntryEditor(entry)}
                  onOpen={() => openOne(entry).catch(error => setMessage(`打开失败 ${errorText(error)}`))}
                />
              ))}
            </Section>
          ) : null}

          {invalidLines.length > 0 ? (
            <Section header={<Text>{`未识别内容（${invalidLines.length} 行）`}</Text>}>
              {invalidLines.slice(0, 10).map((line, index) => (
                <Text key={index} font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                  {/* 无效行常常是残缺的导入链接，里面也可能带密码 */}
                  {maskSecrets(line)}
                </Text>
              ))}
            </Section>
          ) : null}
        </List>
      )}
    </>
  )
}
