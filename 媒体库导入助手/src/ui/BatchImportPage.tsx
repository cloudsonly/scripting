import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
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
import { APP_PRESETS, DEFAULT_CUSTOM_TEMPLATE, appPreset, buildURL } from "../apps"
import type { BatchItem } from "../batch"
import { runBatch, summarizeBatch } from "../batch"
import { requestContinue, waitForReturn } from "../foreground"
import type { SchemeEntry } from "../parse"
import { entryBadges, entryLabel, entrySubtitle, parseEntries, parseRaw } from "../parse"
import type { SubscriptionServer } from "../subscription"
import { parseSubscriptionJSON, serverFromEntry, serversToEntries, splitAddress } from "../subscription"
import { parseNotice } from "../notice"
import type { HistoryRecord, SavedTemplate, Settings } from "../store"
import { loadHistory, loadSettings, loadTemplates, saveHistory, saveSettings, saveTemplates } from "../store"
import HistoryView from "./HistoryView"
import EntryEditorView from "./EntryEditorView"
import TextEditorView from "./TextEditorView"
import ParamDocView from "./ParamDocView"
import TemplateEditorView from "./TemplateEditorView"
import type { TemplateEditorResult } from "./TemplateEditorView"
import { ACCENT, DANGER, PillButton, SUCCESS, setButtonEffects } from "./PillButton"

const WARNING = "#FF9500"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const iconHit = { kind: "interaction", shape: "rect" } as const
  return (
    <HStack spacing={12} opacity={props.disabled ? 0.5 : 1}>
      <Image
        systemName={props.selected ? "checkmark.circle.fill" : "circle"}
        font={20}
        foregroundStyle={props.selected ? ACCENT : "tertiaryLabel"}
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
        {entry.note ? (
          <Text font="caption2" foregroundStyle="#FF9500" lineLimit={2} multilineTextAlignment="leading">
            {entry.note}
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
            {entry.raw}
          </Text>
        ) : null}
      </VStack>
      {/* 行内操作图标：✎ 编辑参数（无效条目也能改）、⤓ 导入这一条。
          用 Image + onTapGesture，避免同一 HStack 里多个 Button 互相连触。 */}
      <HStack spacing={14}>
        <Image
          systemName="square.and.pencil"
          font={19}
          foregroundStyle={ACCENT}
          padding={4}
          contentShape={iconHit}
          onTapGesture={props.disabled ? undefined : props.onEdit}
        />
        {entry.valid ? (
          <Image
            systemName="square.and.arrow.down"
            font={19}
            foregroundStyle={SUCCESS}
            padding={4}
            contentShape={iconHit}
            onTapGesture={props.disabled ? undefined : props.onOpen}
          />
        ) : null}
      </HStack>
    </HStack>
  )
}

/** 输入来源：剪贴板 / 文件（带文件名）/ 手动输入 */
interface OriginInfo {
  kind: "clipboard" | "file" | "manual"
  detail: string
}

/** 服务器身份（用于切换目标 App 时保留勾选状态） */
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

export default function BatchImportPage(props?: { initialText?: string }) {
  const dismiss = Navigation.useDismiss()

  const [source, setSource] = useState("")
  const [entries, setEntries] = useState<SchemeEntry[]>([])
  const [invalidLines, setInvalidLines] = useState<string[]>([])
  const [servers, setServers] = useState<SubscriptionServer[]>([])
  const [serverLineCount, setServerLineCount] = useState(0)
  const [origin, setOrigin] = useState<OriginInfo | null>(null)
  const [manuallyEdited, setManuallyEdited] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [status, setStatus] = useState<"idle" | "running">("idle")
  const [waiting, setWaiting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" })
  const [message, setMessage] = useState("请选择来源：读取剪贴板、导入文本文件，或手动粘贴后解析。")
  const [showEditor, setShowEditor] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFullEditor, setShowFullEditor] = useState(false)
  const [showParamDoc, setShowParamDoc] = useState(false)
  const [templates, setTemplates] = useState<SavedTemplate[]>([])

  const runningRef = useRef(false)
  const settingsRef = useRef(settings)
  const historyRef = useRef(history)
  const serversRef = useRef(servers)
  const templatesRef = useRef(templates)
  /** 「自定URL Scheme」新建期间的进入前现场；返回时没保存就整体撤销 */
  const pendingNewRef = useRef<{ appId: AppId; customTemplate: string; activeTemplateId?: string } | null>(null)
  const entryMapRef = useRef(new Map<string, SchemeEntry>())
  /** 开通通知带来的备注（安全密码 / 到期时间），按 host|port|账号 关联 */
  const notesRef = useRef(new Map<string, string>())
  settingsRef.current = settings
  historyRef.current = history
  serversRef.current = servers
  templatesRef.current = templates
  entryMapRef.current = new Map(entries.map(entry => [entry.id, entry]))

  useEffect(() => {
    setButtonEffects(settings.buttonFX)
    setHistory(loadHistory())
    const stored = loadTemplates()
    setTemplates(stored)
    // 设置里残留「没名字的草稿」会让主页选单冒出一条没人选过的「未命名 Scheme」，进页面先落到真实目标
    if (settings.appId === "custom" && !stored.some(item => item.id === settings.activeTemplateId)) {
      const first = stored[0]
      updateSettings(
        first
          ? { customTemplate: first.template, activeTemplateId: first.id }
          : { appId: APP_PRESETS[0].id, activeTemplateId: undefined }
      )
    }
    // 被系统挂起后回到本页、或脚本被重新触发时，都继续下一条
    const removeResume = Script.onResume(() => requestContinue())
    const preset = props?.initialText ?? Script.queryParameters?.text
    if (typeof preset === "string" && preset.trim().length > 0) {
      applyText(preset, { kind: "manual", detail: "" })
    }
    return removeResume
  }, [])

  const preset = appPreset(settings.appId)
  const customTemplate = settings.customTemplate || DEFAULT_CUSTOM_TEMPLATE
  const importedIds = new Set(history.map(record => record.id))
  const validEntries = entries.filter(entry => entry.valid)
  const selectableEntries = validEntries.filter(entry => !entry.duplicate)
  const selectedEntries = entries.filter(entry => selected.includes(entry.id))
  const importableSelected = selectedEntries.filter(entry => entry.valid)
  const importedCount = entries.filter(entry => importedIds.has(entry.id)).length

  function updateSettings(patch: Partial<Settings>) {
    const next: Settings = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
    return next
  }

  function buildFor(server: SubscriptionServer, target: AppPreset, template: string): string {
    return buildURL(server, target, template)
  }

  /** 把备注贴回条目（备注不写入链接） */
  function attachNotes(list: SchemeEntry[]): SchemeEntry[] {
    if (notesRef.current.size === 0) return list
    return list.map(entry => ({ ...entry, note: notesRef.current.get(entryServerKey(entry)) }))
  }

  /** 来源展示（剪贴板 / 文件（名）/ 手动输入；后两者被改过就追加「+ 手动输入」） */
  function originLabel(): string {
    if (!origin) return ""
    const base =
      origin.kind === "clipboard" ? "剪贴板" : origin.kind === "file" ? `文件（${origin.detail}）` : "手动输入"
    if (manuallyEdited && origin.kind !== "manual") return `${base} + 手动输入`
    return base
  }

  /** 依据服务器列表生成条目；keepSelection=true（换 App / 换方案）时保留原有勾选，含「全部取消」 */
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
    const withNotes = attachNotes(converted.entries)
    const defaults = withNotes.filter(entry => entry.valid && !entry.duplicate).map(entry => entry.id)
    const kept = withNotes
      .filter(entry => entry.valid && !entry.duplicate && keepKeys.has(entryServerKey(entry)))
      .map(entry => entry.id)
    const finalIds = keepSelection ? kept : defaults
    setServers(list)
    setServerLineCount(converted.lineCount)
    setEntries(withNotes)
    setInvalidLines([])
    setSelected(finalIds)
    setOrigin(from)
    setProgress({ done: 0, total: 0, current: "" })
    setMessage(
      `${kindLabel}已生成 ${withNotes.length} 条 ${target.name} 导入链接，已选中 ${finalIds.length} 条` +
        (converted.lineCount > 0 ? `（含 ${converted.lineCount} 条备用线路）` : "")
    )
  }

  function applyText(text: string, from: OriginInfo) {
    const target = appPreset(settingsRef.current.appId)
    const template = settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE
    if (from.kind === "manual") setManuallyEdited(true)
    // 换来源就丢弃上一次通知带来的备注（通知分支随后自行重建）
    notesRef.current = new Map()
    const parsed = parseSubscriptionJSON(text)
    if (parsed) {
      setSource(text)
      applyServers(parsed, target, template, from, "订阅 JSON：")
      return
    }

    // 开通/恢复通知（「创建用户成功」「用户名称 | xxx」这类）
    const notice = parseNotice(text)
    if (notice) {
      const notes = new Map<string, string>()
      for (const item of notice.items) notes.set(serverKey(item.server), item.note)
      notesRef.current = notes
      setSource(text)
      applyServers(
        notice.items.map(item => item.server),
        target,
        template,
        from,
        notice.items.length > 1
          ? `识别到 ${notice.items.length} 条开通通知：${notice.summary}。`
          : `识别到开通通知：${notice.summary}。`
      )
      return
    }

    const result = parseEntries(text)
    const ids = result.entries.filter(entry => entry.valid && !entry.duplicate).map(entry => entry.id)
    setSource(text)
    // 从链接文本也能切换目标 App：把识别出的字段还原成服务器列表（未识别参数会丢失）
    setServers(result.entries.filter(entry => entry.valid).map(serverFromEntry))
    setServerLineCount(0)
    setEntries(result.entries)
    setInvalidLines(result.invalidLines)
    setSelected(ids)
    setOrigin(from)
    setProgress({ done: 0, total: 0, current: "" })
    const parts = [`识别到 ${result.entries.length} 条链接，已选中 ${ids.length} 条`]
    if (result.invalidLines.length > 0) parts.push(`${result.invalidLines.length} 行没有链接`)
    setMessage(parts.join(" · "))
  }

  /** 当前生效的已保存 URL Scheme（为空表示用的是「自定URL Scheme」新建、还没存名的那份） */
  function activeTemplate(): SavedTemplate | undefined {
    return templates.find(item => item.id === settings.activeTemplateId)
  }

  /**
   * 「目标 App」选单的值。已保存的 URL Scheme 也在选单里（`custom:<模板 id>`）；
   * 用未命名新方案时补一个只在当时出现的选项——选单的值必须是它渲染出来的选项之一，
   * 否则显示会卡在上一次的名字上、点了也不触发变更（Rex 那个 bug 就是这么来的）。
   */
  const pickerValue =
    settings.appId !== "custom"
      ? settings.appId
      : activeTemplate()
        ? `custom:${settings.activeTemplateId}`
        : "custom:new"

  /**
   * 选单选项 = 内置 App + 已保存方案，只写名字（不加 emoji 也不配色：Scripting 的 `Picker` 自己渲染选项行，
   * 选项 `Text` 上的 `foregroundStyle` 会被丢掉）。未命名方案期间临时补一条，让 value 始终有对应选项。
   */
  const appOptions: Array<{ tag: string; label: string }> = [
    ...APP_PRESETS.filter(item => item.id !== "custom").map(item => ({ tag: item.id as string, label: item.name })),
    ...templates.map(item => ({ tag: `custom:${item.id}`, label: item.name })),
    ...(pickerValue === "custom:new" ? [{ tag: "custom:new", label: "未命名 Scheme（记得保存）" }] : []),
  ]

  /** 按新目标重算链接（保留原有勾选）；note 为空时沿用 applyServers 自己的统计文案 */
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

  /** 选单变更：内置 App / 某条已保存的 URL Scheme */
  function changeAppValue(value: string) {
    if (value === "custom:new") return
    pendingNewRef.current = null
    if (value.startsWith("custom:")) {
      const item = templatesRef.current.find(entry => entry.id === value.slice("custom:".length))
      if (!item) return
      updateSettings({ appId: "custom", customTemplate: item.template, activeTemplateId: item.id })
      applyTarget(appPreset("custom"), item.template, `已切换到 URL Scheme「${item.name}」。`)
      return
    }
    // 切回内置 App 就与方案脱钩，但文本留着，下次「自定URL Scheme」还能接着改
    const next = updateSettings({ appId: value as AppId, activeTemplateId: undefined })
    applyTarget(appPreset(value as AppId), next.customTemplate || DEFAULT_CUSTOM_TEMPLATE, "")
  }

  /**
   * 点行尾「自定URL Scheme（新建）›」= **新建**一份未命名方案（不与任何已保存方案合并）：
   * 内容用默认骨架，之后在参数说明页里改，保存时才取名。
   * 已经在编辑未命名方案时只回到那一页，不重置正在写的内容。
   */
  function openCustomTemplateDoc() {
    const editingUnbound =
      settingsRef.current.appId === "custom" &&
      !templatesRef.current.some(item => item.id === settingsRef.current.activeTemplateId)
    if (!editingUnbound) {
      pendingNewRef.current = {
        appId: settingsRef.current.appId,
        customTemplate: settingsRef.current.customTemplate,
        activeTemplateId: settingsRef.current.activeTemplateId,
      }
      updateSettings({ appId: "custom", customTemplate: DEFAULT_CUSTOM_TEMPLATE, activeTemplateId: undefined })
      applyTarget(appPreset("custom"), DEFAULT_CUSTOM_TEMPLATE, "新建了一份未命名 URL Scheme。")
    }
    setShowParamDoc(true)
  }

  /** 撤销这次「新建」：回到进入前的目标，选单里不会留下未命名那一项 */
  function abandonNewTemplate() {
    const snapshot = pendingNewRef.current
    pendingNewRef.current = null
    if (!snapshot) return
    const bound = snapshot.activeTemplateId
      ? templatesRef.current.find(item => item.id === snapshot.activeTemplateId)
      : undefined
    const template = (bound ? bound.template : snapshot.customTemplate) || DEFAULT_CUSTOM_TEMPLATE
    updateSettings({
      appId: snapshot.appId,
      customTemplate: template,
      activeTemplateId: bound ? bound.id : undefined,
    })
    applyTarget(appPreset(snapshot.appId), template, "")
  }

  /** 命名弹层（新建方案取名用）：在弹层里保存成功 = 取名 + 直接用该方案 + 关掉参数说明页回主页 */
  function openTemplateEditor(seed?: string) {
    Navigation.present<TemplateEditorResult>({
      element: (
        <TemplateEditorView
          template={seed && seed.trim().length > 0 ? seed : settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE}
          templates={templatesRef.current}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        // 弹层只有「保存」这一个出口（必带 savedId），点「取消」什么都不回传
        if (!result?.savedId) return
        const template = result.template.trim() || DEFAULT_CUSTOM_TEMPLATE
        const name = result.templates.find(item => item.id === result.savedId)?.name ?? "URL Scheme"
        templatesRef.current = result.templates
        setTemplates(result.templates)
        saveTemplates(result.templates)
        pendingNewRef.current = null
        updateSettings({ customTemplate: template, activeTemplateId: result.savedId })
        applyTarget(appPreset("custom"), template, `已保存为「${name}」，改用这条方案。`)
        setShowParamDoc(false)
      })
      .catch(error => setMessage(`保存失败：${errorText(error)}`))
  }

  /** 参数说明页的保存：选中了已保存方案就地覆盖（不弹层），没名字才弹层取名 */
  function saveTemplateFromDoc(current: string) {
    const template = current.trim()
    if (!template) {
      setMessage("内容是空的，先写点东西。")
      return
    }
    const active = templatesRef.current.find(item => item.id === settingsRef.current.activeTemplateId)
    if (!active) {
      openTemplateEditor(template)
      return
    }
    const next = templatesRef.current.map(item => (item.id === active.id ? { ...item, template } : item))
    templatesRef.current = next
    setTemplates(next)
    saveTemplates(next)
    updateSettings({ customTemplate: template })
    pendingNewRef.current = null
    applyTarget(appPreset("custom"), template, `已保存到 URL Scheme「${active.name}」。`)
  }

  /**
   * 参数说明页的返回：没动过就直接关（未命名那份顺手撤销）；
   * 改过没保存就问一句「保存 / 丢弃」，取消则留在本页，绝不静悄悄丢掉用户写的东西。
   */
  function closeTemplateDoc(current: string, dirty: boolean) {
    const active = activeTemplate()
    if (!dirty) {
      if (!active) abandonNewTemplate()
      setShowParamDoc(false)
      return
    }
    Dialog.actionSheet({
      title: "内容改了还没保存",
      message: active ? `保存会覆盖 URL Scheme「${active.name}」。` : "这份还没有名字，保存时要取个名字。",
      actions: [{ label: active ? `保存到「${active.name}」` : "保存并取名" }, { label: "丢弃改动", destructive: true }],
      cancelButton: true,
    })
      .then(choice => {
        if (choice === 0) {
          if (active) {
            saveTemplateFromDoc(current)
            setShowParamDoc(false)
          } else {
            openTemplateEditor(current)
          }
          return
        }
        if (choice === 1) {
          // 未命名那份整体撤销；已保存方案的改动只留在示例区里，设置没动过，关掉就等于丢弃
          if (!active) abandonNewTemplate()
          setShowParamDoc(false)
        }
      })
      .catch(error => setMessage(`保存失败：${errorText(error)}`))
  }

  /**
   * 参数说明页右上角 🗑：删掉这条已保存方案，然后直接回主页。
   * 目标落回一个真实存在的选项（进来前那份 → 剩下的第一条 → 第一个内置 App），
   * 否则主页选单会出现没有主人的「未命名 Scheme」。
   */
  function deleteActiveTemplate() {
    const active = templatesRef.current.find(item => item.id === settingsRef.current.activeTemplateId)
    if (!active) return
    Dialog.confirm({
      title: `删除「${active.name}」？`,
      message: "这条方案连同正文一起删除，然后回到主页。",
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
      .then(confirmed => {
        if (!confirmed) return
        const next = templatesRef.current.filter(item => item.id !== active.id)
        templatesRef.current = next
        setTemplates(next)
        saveTemplates(next)
        if (next.length > 0) {
          const fallback = next[0]
          updateSettings({ appId: "custom", customTemplate: fallback.template, activeTemplateId: fallback.id })
          applyTarget(appPreset("custom"), fallback.template, `已删除「${active.name}」，改用「${fallback.name}」。`)
        } else {
          const first = APP_PRESETS[0]
          const after = updateSettings({ appId: first.id, activeTemplateId: undefined })
          applyTarget(
            appPreset(first.id),
            after.customTemplate || DEFAULT_CUSTOM_TEMPLATE,
            `已删除「${active.name}」，切回 ${first.name}。`
          )
        }
        setShowParamDoc(false)
      })
      .catch(error => setMessage(`删除失败：${errorText(error)}`))
  }

  /** 这条链接是给哪个 App 的（按 scheme 判断，历史记录里重新导入时更准） */
  function appNameForRaw(raw: string): string {
    const matched = APP_PRESETS.find(item => raw.toLowerCase().startsWith(`${item.scheme.toLowerCase()}://`))
    return matched ? matched.name : appPreset(settingsRef.current.appId).name
  }

  function addRecord(entry: SchemeEntry) {
    const record: HistoryRecord = {
      id: entry.id,
      title: entry.title,
      host: entry.host ? `${entry.host}${entry.port ? ":" + entry.port : ""}` : entry.scheme,
      account: entry.username,
      type: entry.type || entry.scheme,
      app: appNameForRaw(entry.raw),
      raw: entry.raw,
      at: Date.now(),
    }
    const next = [record, ...historyRef.current.filter(item => item.id !== record.id)]
    historyRef.current = next
    setHistory(next)
    saveHistory(next)
  }

  function clearHistory() {
    historyRef.current = []
    setHistory([])
    saveHistory([])
    setMessage("已清除全部导入记录。")
  }

  /** 历史记录：删除若干条（多选删除用） */
  function deleteRecords(ids: string[]) {
    const removed = new Set(ids)
    const next = historyRef.current.filter(record => !removed.has(record.id))
    historyRef.current = next
    setHistory(next)
    saveHistory(next)
    setMessage(`已删除 ${ids.length} 条记录。`)
  }

  /** 历史记录：列表内改动（左划删除）后持久化 */
  function replaceHistory(records: HistoryRecord[]) {
    historyRef.current = records
    setHistory(records)
    saveHistory(records)
  }

  /** 历史记录：编辑某条的参数（弹层，保存后更新该条记录） */
  function openRecordEditor(record: HistoryRecord) {
    if (!record.raw) {
      setMessage("这条旧记录没有保存链接，无法编辑。")
      return
    }
    const recordPreset = APP_PRESETS.find(item => item.name === record.app) ?? preset
    Navigation.present<SubscriptionServer>({
      element: (
        <EntryEditorView
          entry={parseRaw(record.raw)}
          appName={recordPreset.name}
          buildPreview={server => buildFor(server, recordPreset, customTemplate)}
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
        historyRef.current = next
        setHistory(next)
        saveHistory(next)
        setMessage(`已更新记录「${updated.title || updated.host}」。`)
      })
      .catch(error => setMessage(`编辑记录失败：${errorText(error)}`))
  }

  /** 历史记录里重新导入：只跑这批链接，不把内容灌回主页的待导入列表 */
  function importRecords(picked: HistoryRecord[]) {
    const raws = picked.map(record => record.raw).filter((raw): raw is string => !!raw)
    if (raws.length === 0) {
      setMessage("选中的记录没有保存链接（旧版本记录），无法重新导入。")
      return
    }
    const usable = raws.map(raw => parseRaw(raw)).filter(entry => entry.valid)
    if (usable.length === 0) {
      setMessage("选中的记录里没有可导入的链接。")
      return
    }
    // 回主页只为了看进度和「停止」，列表内容保持原样
    setShowHistory(false)
    startBatch(usable, { ignoreSkipDone: true })
  }

  /** 重置当前输入（剪贴板 / 文件 / 手动输入）与识别结果 */
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
    notesRef.current = new Map()
    setProgress({ done: 0, total: 0, current: "" })
    setMessage("已重置：当前输入与识别结果都清空了。")
  }

  /** 打开单条条目的参数编辑（弹层，不影响列表滚动位置） */
  function openEntryEditor(entry: SchemeEntry) {
    Navigation.present<SubscriptionServer>({
      element: (
        <EntryEditorView
          entry={entry}
          appName={preset.name}
          buildPreview={server => buildFor(server, preset, customTemplate)}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (result) applyEntryEdit(entry, result)
      })
      .catch(error => setMessage(`编辑失败：${errorText(error)}`))
  }

  /** 保存单条条目的参数修改：用新参数重建链接，并保留勾选状态 */
  function applyEntryEdit(target: SchemeEntry, server: SubscriptionServer) {
    const raw = buildFor(server, preset, customTemplate)
    const updated = parseRaw(raw)
    updated.note = target.note
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
        setMessage("剪贴板里没有可用的文本，请先复制导入链接或订阅 JSON。")
        return
      }
      applyText(text, { kind: "clipboard", detail: "" })
    } catch (error) {
      setMessage(`读取剪贴板失败：${errorText(error)}`)
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
          setMessage(`读取文件失败：${errorText(error)}`)
        }
      }
      if (texts.length === 0) return
      const names = paths.map(path => path.split("/").pop() || path)
      applyText(texts.join("\n"), { kind: "file", detail: names.length === 1 ? names[0] : `${names.length} 个文件` })
    } catch (error) {
      setMessage(`导入文本文件失败：${errorText(error)}`)
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
      setMessage(`该链接缺少服务器地址，无法导入：${entry.raw}`)
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
    // 最终统计（含「已停止（剩余 N 条）」）会在当前这条等待结束后覆盖这里
    setMessage("正在停止…")
  }

  async function startBatch(queueOverride?: SchemeEntry[], options?: { ignoreSkipDone?: boolean }) {
    const queue = queueOverride ?? entries.filter(entry => selected.includes(entry.id) && entry.valid)
    if (queue.length === 0) {
      setMessage("没有选中的可导入链接。")
      return
    }
    const doneIds = new Set(historyRef.current.map(record => record.id))
    const skipDone = settingsRef.current.skipDone && !options?.ignoreSkipDone
    const pending = skipDone ? queue.filter(entry => !doneIds.has(entry.id)) : queue
    if (pending.length === 0) {
      setMessage(`选中的 ${queue.length} 条都已经导入过了；可在「高级」里关闭「跳过已导入过的链接」。`)
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
    setMessage(summary)

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

  async function copySelected() {
    const list = selectedEntries.length > 0 ? selectedEntries : validEntries
    if (list.length === 0) {
      setMessage("没有可复制的链接。")
      return
    }
    await Pasteboard.setString(list.map(entry => entry.raw).join("\n"))
    setMessage(`已复制 ${list.length} 条 ${preset.name} 链接到剪贴板。`)
  }

  return (
    <NavigationStack>
      {showFullEditor ? (
        <TextEditorView
          text={source}
          onParse={text => {
            applyText(text, { kind: "manual", detail: "" })
            setShowFullEditor(false)
          }}
          onCancel={() => setShowFullEditor(false)}
        />
      ) : showParamDoc ? (
        <ParamDocView
          preset={preset}
          onBack={() => setShowParamDoc(false)}
          onCloseTemplate={preset.id === "custom" ? closeTemplateDoc : undefined}
          onEditTemplate={preset.id === "custom" ? saveTemplateFromDoc : undefined}
          onDeleteTemplate={preset.id === "custom" && activeTemplate() ? deleteActiveTemplate : undefined}
          activeTemplateName={preset.id === "custom" ? activeTemplate()?.name : undefined}
          initialSample={preset.id === "custom" ? customTemplate : undefined}
        />
      ) : showHistory ? (
        <HistoryView
          records={history}
          onBack={() => setShowHistory(false)}
          onClear={clearHistory}
          onDelete={deleteRecords}
          onChange={replaceHistory}
          onEdit={openRecordEditor}
          onImport={importRecords}
        />
      ) : (
        <List
          navigationTitle="媒体库导入助手"
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
          <Section
            header={<Text>来源</Text>}
            footer={
              <Text>
                {"复制内容后点「读取剪贴板」，也可以导入文件或手动粘贴再解析。\n支持三种内容：\n· 导入链接（rex:// 等任意 Scheme）\n· 线路汇总 JSON\n· 开通通知（自动填好账号密码）"}
              </Text>
            }
          >
            <HStack spacing={10}>
              <PillButton
                title="读取剪贴板"
                action={() => importFromClipboard().catch(error => setMessage(`读取剪贴板失败：${errorText(error)}`))}
              />
              <PillButton
                title="导入 JSON / 文本文件"
                color={SUCCESS}
                action={() => importFromFile().catch(error => setMessage(`导入文件失败：${errorText(error)}`))}
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
                  prompt="粘贴导入链接或订阅 JSON"
                  value={source}
                  onChanged={setSource}
                  axis="vertical"
                  lineLimit={{ min: 4, max: 8 }}
                  frame={{ maxWidth: "infinity" }}
                />
                <Image
                  systemName="arrow.up.left.and.arrow.down.right"
                  font={20}
                  foregroundStyle={ACCENT}
                  onTapGesture={() => setShowFullEditor(true)}
                />
              </HStack>
            ) : null}
            {showEditor ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                点输入框右侧的 ⤢ 图标可全屏编辑（长文本更好改）。
              </Text>
            ) : null}
            <Text font="caption" foregroundStyle="secondaryLabel">
              {message}
            </Text>
          </Section>

          <Section
            header={<Text>导入到</Text>}
            footer={
              <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text
                  font="caption"
                  foregroundStyle={ACCENT}
                  contentShape={{ kind: "interaction", shape: "rect" }}
                  onTapGesture={() => setShowParamDoc(true)}
                >
                  {preset.id === "custom" ? "编辑 ›" : `参数说明（${preset.name}）›`}
                </Text>
                <Spacer />
                <Text
                  font="caption"
                  foregroundStyle={ACCENT}
                  contentShape={{ kind: "interaction", shape: "rect" }}
                  onTapGesture={openCustomTemplateDoc}
                >
                  {"自定URL Scheme（新建）›"}
                </Text>
              </HStack>
            }
          >
            <Picker title="目标 App" value={pickerValue} onChanged={(value: string) => changeAppValue(value)}>
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
                <Text foregroundStyle={SUCCESS}>{validEntries.length}</Text>
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
                <Text foregroundStyle={WARNING}>{validEntries.length - selectableEntries.length}</Text>
              </HStack>
              <HStack>
                <Text>已导入过</Text>
                <Spacer />
                <Text foregroundStyle="secondaryLabel">{importedCount}</Text>
              </HStack>
              <HStack>
                <Text>已选中</Text>
                <Spacer />
                <Text foregroundStyle={ACCENT}>{selectedEntries.length}</Text>
              </HStack>
            </Section>
          ) : null}

          {entries.length > 0 ? (
            <Section
              header={<Text>批量导入</Text>}
              footer={
                <Text>
                  {`点「开始导入」后逐条打开 ${preset.name}：在 App 里确认导入、回到本页即自动继续下一条；若检测不到，最多等 10 秒也会自己继续（也可点「立即下一条」）。`}
                </Text>
              }
            >
              {status === "running" ? (
                <PillButton title="停止" color={DANGER} action={stopBatch} />
              ) : (
                <PillButton
                  title={`开始导入（${importableSelected.length} 条已选中）`}
                  disabled={importableSelected.length === 0}
                  action={() => startBatch().catch(error => setMessage(`导入失败：${errorText(error)}`))}
                />
              )}
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
            <Section
              header={<Text>{`待导入列表（${selectedEntries.length}/${entries.length}）`}</Text>}
              footer={<Text>点按行首圆点或中间文字可勾选；右侧 ✎ 改这条参数，⤓ 只导入这一条。</Text>}
            >
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
                  imported={importedIds.has(entry.id)}
                  disabled={status === "running"}
                  onToggle={() =>
                    setSelected(current =>
                      current.includes(entry.id) ? current.filter(item => item !== entry.id) : [...current, entry.id]
                    )
                  }
                  onEdit={() => openEntryEditor(entry)}
                  onOpen={() => openOne(entry).catch(error => setMessage(`打开失败：${errorText(error)}`))}
                />
              ))}
            </Section>
          ) : null}

          {invalidLines.length > 0 ? (
            <Section header={<Text>{`未识别内容（${invalidLines.length} 行）`}</Text>}>
              {invalidLines.slice(0, 10).map((line, index) => (
                <Text key={index} font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                  {line}
                </Text>
              ))}
            </Section>
          ) : null}

          <Section
            header={<Text>高级</Text>}
            footer={
              <Text>
                {
                  "「跳过已导入过的链接」：开始导入时，「导入记录」里已经有的一律略过（按链接比对，改了参数就会重新导入）；关掉才会重复导入。\n「结束后发送通知」：批量导入跑完发一条本机通知汇报成功 / 失败，不用守在页面上。\n「按钮动效与震动」：点胶囊按钮时轻震一下、按钮同时缩一下；关掉两者都没有（只影响这些自绘按钮，不影响系统控件）。"
                }
              </Text>
            }
          >
            <Toggle
              title="跳过已导入过的链接"
              value={settings.skipDone}
              onChanged={value => updateSettings({ skipDone: value })}
            />
            <Toggle
              title="结束后发送通知"
              value={settings.notify}
              onChanged={value => updateSettings({ notify: value })}
            />
            <Toggle
              title="按钮动效与震动"
              value={settings.buttonFX}
              onChanged={value => {
                setButtonEffects(value)
                updateSettings({ buttonFX: value })
              }}
            />
            <PillButton
              title="复制链接"
              disabled={entries.length === 0}
              action={() => copySelected().catch(error => setMessage(`复制失败：${errorText(error)}`))}
            />
          </Section>
        </List>
      )}
    </NavigationStack>
  )
}
