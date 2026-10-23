import {
  Button,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  Notification,
  Picker,
  Script,
  Section,
  Spacer,
  Text,
  VStack,
  fetch,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import type { VirtualNode } from "scripting"
import type { AppId, AppPreset } from "../apps"
import { APP_PRESETS, DEFAULT_CUSTOM_TEMPLATE, appPreset, appNameForRaw, buildURL } from "../apps"
import type { BatchItem } from "../batch"
import { runBatch, summarizeBatch } from "../batch"
import type { BackupContent } from "../backupFormat"
import { buildBackupJSON, isBackupJSON, mergeBackup, mergeIconLibraries, mergeTemplates, parseBackupJSON } from "../backupFormat"
import { requestContinue, waitForReturn } from "../foreground"
import type { LibraryGroup, LibraryServer, SortKey } from "../library"
import {
  allTags,
  applyTagsTo,
  dropGroup,
  fromSubscriptionServer,
  hasTags,
  newServerId,
  normalizeTags,
  orderTags,
  parseAfusektJSON,
  removeTag,
  renameTag,
  SORT_LABELS,
  sortServers,
  toAfusektJSON,
  toSubscriptionServer,
  upsertServers,
} from "../library"
import type { HistoryRecord, SavedIconLibrary, SavedTemplate, Settings } from "../store"
import type { EditorResult } from "./EntryEditorView"
import EntryEditorView from "./EntryEditorView"
import type { GroupNameResult } from "./GroupNameView"
import GroupNameView from "./GroupNameView"
import { PillButton } from "./PillButton"
import { ACCENT_TEXT, DANGER, SUCCESS, SUCCESS_TEXT } from "./tokens"

const LATENCY_SUCCESS: "#34C759" = "#34C759"
const LATENCY_INFO: "#0A84FF" = "#0A84FF"
const LATENCY_WARNING: "#FF9500" = "#FF9500"
const LATENCY_DANGER: "#FF3B30" = "#FF3B30"
const LATENCY_UNKNOWN: "secondaryLabel" = "secondaryLabel"

type LatencyStatus = { label: string; color: "#34C759" | "#0A84FF" | "#FF9500" | "#FF3B30" | "secondaryLabel"; checkedAt: number }
const latencyCache = new Map<string, LatencyStatus>()

function latencyURL(address: string): string {
  const raw = String(address || "").trim().replace(/\/+$/, "")
  if (!raw) return ""
  return raw
}

function latencyColor(ms: number): "#34C759" | "#0A84FF" | "#FF9500" {
  if (ms <= 200) return LATENCY_SUCCESS
  if (ms <= 500) return LATENCY_INFO
  return LATENCY_WARNING
}

async function checkLatency(address: string): Promise<LatencyStatus> {
  const url = latencyURL(address)
  if (!url) return { label: "断联", color: LATENCY_DANGER, checkedAt: Date.now() }
  const started = Date.now()
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500))
  try {
    // 先 HEAD，几乎不下载正文；不要求 2xx，401/403/404 也证明线路已经连通。
    // 只有网络层拒绝 HEAD 时才退回 GET，避免把正常反代误判成断联。
    try {
      await Promise.race([fetch(url, { method: "HEAD" }), timeout])
    } catch (headError) {
      if (String(headError).toLowerCase().indexOf("timeout") >= 0) throw headError
      await Promise.race([fetch(url, { method: "GET" }), timeout])
    }
    const ms = Math.max(1, Date.now() - started)
    return { label: `${ms}ms`, color: latencyColor(ms), checkedAt: Date.now() }
  } catch (error) {
    const timedOut = String(error).toLowerCase().indexOf("timeout") >= 0
    return { label: timedOut ? "超时" : "断联", color: LATENCY_DANGER, checkedAt: Date.now() }
  }
}
import type { TagOption } from "./TagChip"
import { TagGroup } from "./TagChip"
import TagAssignView from "./TagAssignView"
import type { TagAssignResult } from "./TagAssignView"
import SortPickerView from "./SortPickerView"


function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const ROOT_GROUP_LABEL = "默认分组"

function ServerRow(props: {
  server: LibraryServer
  groupName: string
  disabled: boolean
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
  onEdit: () => void
  importTitle: string
  onImport: () => void
  onDelete: () => void
  latency?: LatencyStatus
}) {
  const server = props.server
  const splitHost = server.address.replace(/^https?:\/\//, "")
  const actions = [
    <Button key="import" title={props.importTitle} tint={SUCCESS} action={props.disabled ? () => {} : props.onImport} />,
    <Button key="delete" title="删除" role="destructive" action={props.disabled ? () => {} : props.onDelete} />,
  ]
  const onRowTap = props.selectable && props.onToggle ? props.onToggle : props.onEdit
  return (
    <HStack spacing={12} trailingSwipeActions={{ allowsFullSwipe: false, actions }}>
      {server.icon ? (
        <Image
          imageUrl={server.icon}
          resizable={true}
          frame={{ width: 34, height: 34 }}
          clipShape={{ type: "rect", cornerRadius: 8 }}
          placeholder={<VStack frame={{ width: 34, height: 34 }} />}
        />
      ) : (
        <VStack frame={{ width: 34, height: 34 }} />
      )}
      {props.selectable ? (
        <Image
          systemName={props.selected ? "checkmark.circle.fill" : "circle"}
          font={20}
          foregroundStyle={props.selected ? ACCENT_TEXT : "tertiaryLabel"}
          contentShape={{ kind: "interaction", shape: "rect" }}
          onTapGesture={props.onToggle}
        />
      ) : null}
      <VStack
        alignment="leading"
        spacing={2}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        contentShape={{ kind: "interaction", shape: "rect" }}
        onTapGesture={props.disabled ? undefined : onRowTap}
      >
        <HStack spacing={6}>
          <Text bold={true} lineLimit={1} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            {server.name || splitHost || "（未命名）"}
          </Text>
          <Text font="caption" bold={true} foregroundStyle={props.latency ? props.latency.color : LATENCY_UNKNOWN}>
            {props.latency ? props.latency.label : "…"}
          </Text>
        </HStack>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} truncationMode="middle" multilineTextAlignment="leading">
          {[
            (server.type || "emby").toUpperCase(),
            splitHost,
            server.account,
            server.lines.length > 0 ? `${server.lines.length} 条备用线路` : "",
          ]
            .filter(value => !!value)
            .join(" · ")}
        </Text>
        {server.tags.length > 0 || server.remark ? (
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} truncationMode="tail" multilineTextAlignment="leading">
            {[server.tags.join(" · "), server.remark].filter(value => !!value).join(" · ")}
          </Text>
        ) : null}
        {props.groupName ? (
          <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={1}>
            {props.groupName}
          </Text>
        ) : null}
      </VStack>
    </HStack>
  )
}

export default function LibraryPage(props: {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => Settings
  servers: LibraryServer[]
  groups: LibraryGroup[]
  writeLibrary: (servers: LibraryServer[], groups: LibraryGroup[]) => boolean
  history: HistoryRecord[]
  writeHistory: (records: HistoryRecord[]) => boolean
  templates: SavedTemplate[]
  writeTemplates: (list: SavedTemplate[]) => boolean
  iconLibraries: SavedIconLibrary[]
  writeIconLibraries: (list: SavedIconLibrary[]) => boolean
  mode: "browse" | "search"
  notice?: string
}) {
  const dismiss = Navigation.useDismiss()
  const searching = props.mode === "search"
  const [search, setSearch] = useState("")
  const [keyword, setKeyword] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const [openGroups, setOpenGroups] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [tagEditing, setTagEditing] = useState(false)
  const [sortingTag, setSortingTag] = useState("")
  const [undo, setUndo] = useState<{ server: LibraryServer; index: number } | null>(null)
  const [status, setStatus] = useState<"idle" | "running">("idle")
  const [waiting, setWaiting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" })
  const [message, setMessage] = useState(props.notice || "")
  const [toastOn, setToastOn] = useState(false)
  const lastMessageRef = useRef(props.notice || "")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!message || message === lastMessageRef.current) return
    lastMessageRef.current = message
    setToastOn(true)
    const timer = setTimeout(() => setToastOn(false), 4000)
    return () => clearTimeout(timer)
  }, [message])

  const runningRef = useRef(false)
  const serversRef = useRef(props.servers)
  const groupsRef = useRef(props.groups)
  const historyRef = useRef(props.history)
  const settingsRef = useRef(props.settings)
  const templatesRef = useRef(props.templates)
  const iconLibrariesRef = useRef(props.iconLibraries)
  serversRef.current = props.servers
  groupsRef.current = props.groups
  historyRef.current = props.history
  settingsRef.current = props.settings
  templatesRef.current = props.templates
  iconLibrariesRef.current = props.iconLibraries

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setKeyword(search.trim().toLowerCase()), 120)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [search])

  const groupNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of props.groups) map.set(group.id, group.name)
    return map
  }, [props.groups])
  const groupNameOf = (groupId: string) => groupNames.get(groupId) || ""
  const matches = (server: LibraryServer) => {
    if (!hasTags(server, tagFilter)) return false
    if (!keyword) return true
    const haystack = [
      server.name,
      server.address,
      server.account,
      server.type,
      groupNameOf(server.groupId),
      server.tags.join(" "),
      ...server.lines.map(line => `${line.name} ${line.address}`),
    ]
      .join(" ")
      .toLowerCase()
    return haystack.indexOf(keyword) >= 0
  }
  const tagCounts = useMemo(() => allTags(props.servers), [props.servers])
  const ordered = useMemo(() => orderTags(tagCounts, props.settings.tagOrder), [tagCounts, props.settings.tagOrder])
  const countIn = (list: Array<{ tag: string; count: number }>, tag: string) => {
    const key = tag.toLowerCase()
    const found = list.find(item => item.tag.toLowerCase() === key)
    return found ? found.count : 0
  }
  const tagFacets = useMemo(() => allTags(props.servers, tagFilter), [props.servers, tagFilter])
  const tagOptions = useMemo(() => ordered.map(item => ({ tag: item.tag, count: countIn(tagFacets, item.tag) })), [ordered, tagFacets])
  const tagServersOf = (tag: string) => props.servers.filter(item => hasTags(item, [tag]))
  const isTagOn = (list: string[], tag: string) => list.some(item => item.toLowerCase() === tag.toLowerCase())
  const filterTagItems: TagOption[] = tagOptions.map(item => ({
    label: item.tag,
    count: item.count,
    on: tagEditing ? false : isTagOn(tagFilter, item.tag),
    action: () => (tagEditing ? tapTag(item.tag) : toggleTagFilter(item.tag)),
    longPress: tagEditing ? () => pickTagToSort(item.tag) : undefined,
  }))
  const pickedSet = useMemo(() => new Set(picked), [picked])
  const batchOn = useMemo(() => ordered
    .map(item => item.tag)
    .filter(tag => {
      const inside = props.servers.filter(item => hasTags(item, [tag]))
      return inside.length > 0 && inside.every(server => pickedSet.has(server.id))
    }), [ordered, props.servers, pickedSet])
  const batchFacets = useMemo(() => allTags(props.servers, batchOn), [props.servers, batchOn])
  const pickTagItems: TagOption[] = ordered.map(item => ({
    label: item.tag,
    count: countIn(batchFacets, item.tag),
    on: batchOn.indexOf(item.tag) >= 0,
    action: () => toggleTagPick(item.tag),
  }))
  function toggleTagFilter(tag: string) {
    const next = isTagOn(tagFilter, tag)
      ? tagFilter.filter(item => item.toLowerCase() !== tag.toLowerCase())
      : tagFilter.concat(tag)
    setTagFilter(next)
    expandGroupsForFilter(next)
  }
  function clearTagFilter() {
    setTagFilter([])
    setOpenGroups([])
  }
  function groupKeysOf(list: LibraryServer[]) {
    const keys: string[] = []
    for (const server of list) {
      const key = server.groupId && props.groups.some(group => group.id === server.groupId) ? server.groupId : "root"
      if (keys.indexOf(key) < 0) keys.push(key)
    }
    return keys
  }
  function expandGroupsForFilter(tags: string[]) {
    if (tags.length === 0) {
      setOpenGroups([])
      return
    }
    setOpenGroups(groupKeysOf(props.servers.filter(item => hasTags(item, tags))))
  }
  function expandGroupsPicking(tags: string[]) {
    const keys = groupKeysOf(props.servers.filter(item => hasTags(item, tags)))
    if (keys.length === 0) return
    setOpenGroups(current => {
      const next = current.slice()
      for (const key of keys) if (next.indexOf(key) < 0) next.push(key)
      return next
    })
  }
  function swapTags(from: number, to: number) {
    const labels = tagOptions.map(item => item.tag)
    if (from < 0 || to < 0 || from >= labels.length || to >= labels.length || from === to) return
    const next = labels.slice()
    const held = next[from]
    next[from] = next[to]
    next[to] = held
    props.updateSettings({ tagOrder: next })
  }
  function pickTagToSort(tag: string) {
    setSortingTag(current => (current === tag ? "" : tag))
  }
  function tapTag(tag: string) {
    if (!sortingTag) {
      renameTagFlow(tag)
      return
    }
    const labels = tagOptions.map(item => item.tag)
    const from = labels.indexOf(sortingTag)
    const to = labels.indexOf(tag)
    if (from >= 0 && to >= 0) swapTags(from, to)
    setSortingTag("")
  }

  function syncTagOrder(patch: (list: string[]) => string[]) {
    props.updateSettings({ tagOrder: patch(props.settings.tagOrder) })
  }

  function deleteTag(tag: string) {
    const inside = tagServersOf(tag)
    const list = removeTag(serversRef.current, tag)
    if (!write(list, groupsRef.current)) return
    setTagFilter(current => current.filter(item => item.toLowerCase() !== tag.toLowerCase()))
    if (sortingTag.toLowerCase() === tag.toLowerCase()) setSortingTag("")
    syncTagOrder(current => current.filter(item => item.toLowerCase() !== tag.toLowerCase()))
    setMessage(`已移除标签 ${tag} 共 ${inside.length} 台`)
  }

  function renameTagFlow(tag: string) {
    Dialog.prompt({ title: `标签「${tag}」改名`, defaultValue: tag, confirmLabel: "保存", cancelLabel: "取消" })
      .then(name => {
        const next = normalizeTags(String(name || "").trim())[0] || ""
        if (!next || next.toLowerCase() === tag.toLowerCase()) return
        const affected = tagServersOf(tag).length
        const list = renameTag(serversRef.current, tag, next)
        if (!write(list, groupsRef.current)) return
        setTagFilter(current => current.map(item => (item.toLowerCase() === tag.toLowerCase() ? next : item)))
        if (sortingTag.toLowerCase() === tag.toLowerCase()) setSortingTag("")
        syncTagOrder(current => current.map(item => (item.toLowerCase() === tag.toLowerCase() ? next : item)))
        setMessage(`标签已改为 ${next} 共 ${affected} 台`)
      })
      .catch(error => setMessage(`标签改名失败 ${errorText(error)}`))
  }
  const visible = useMemo(() => sortServers(
    props.servers.filter(matches),
    props.settings.librarySort,
    props.settings.librarySortDesc
  ), [props.servers, props.settings.librarySort, props.settings.librarySortDesc, keyword, tagFilter, groupNames])
  const pickedServers = props.servers.filter(server => picked.includes(server.id))
  const [latencies, setLatencies] = useState<Record<string, LatencyStatus>>({})
  const visibleIds = visible.map(server => server.id).join(",")

  useEffect(() => {
    let active = true
    const run = async () => {
      // 小批量并发，避免逐条等待导致整页很慢，也避免一次性冲击网络。
      for (let start = 0; start < visible.length; start += 4) {
        if (!active) return
        const batch = visible.slice(start, start + 4)
        const updates: Record<string, LatencyStatus> = {}
        await Promise.all(batch.map(async server => {
          const cached = latencyCache.get(server.address)
          if (cached && Date.now() - cached.checkedAt < (cached.color === LATENCY_DANGER ? 30000 : 60000)) {
            updates[server.id] = cached
            return
          }
          const result = await checkLatency(server.address)
          latencyCache.set(server.address, result)
          updates[server.id] = result
        }))
        if (active && Object.keys(updates).length > 0) setLatencies(current => ({ ...current, ...updates }))
      }
    }
    run().catch(error => console.log("线路延迟检测失败", error))
    return () => { active = false }
  }, [visibleIds])

  const targetTag =
    props.settings.appId === "custom"
      ? props.templates.some(item => item.id === props.settings.activeTemplateId)
        ? `tpl:${props.settings.activeTemplateId}`
        : APP_PRESETS[0].id
      : props.settings.appId

  function resolveTarget(tag: string): { preset: AppPreset; template: string } {
    if (tag.startsWith("tpl:")) {
      const saved = props.templates.find(item => item.id === tag.slice(4))
      return {
        preset: appPreset("custom"),
        template: (saved && saved.template.trim()) || settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE,
      }
    }
    const target = appPreset(tag as AppId)
    return { preset: target, template: target.id === "custom" ? settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE : "" }
  }

  function appLabel(tag: string): string {
    if (tag.startsWith("tpl:")) {
      const saved = props.templates.find(item => item.id === tag.slice(4))
      return saved ? saved.name || "未命名方案" : "自定方案"
    }
    return appPreset(tag as AppId).name
  }

  const appOptions: Array<{ tag: string; label: string }> = [
    ...APP_PRESETS.filter(item => item.id !== "custom").map(item => ({ tag: item.id as string, label: item.name })),
    ...props.templates.map(item => ({ tag: `custom:${item.id}`, label: item.name || "未命名方案" })),
  ]
  const pickerValue =
    props.settings.appId !== "custom"
      ? (props.settings.appId as string)
      : props.templates.some(item => item.id === props.settings.activeTemplateId)
        ? `custom:${props.settings.activeTemplateId}`
        : (APP_PRESETS[0].id as string)

  function changeAppValue(value: string) {
    if (value.indexOf("custom:") === 0) {
      const id = value.slice("custom:".length)
      const saved = templatesRef.current.find(item => item.id === id)
      if (!saved) return
      props.updateSettings({
        appId: "custom",
        customTemplate: saved.template.trim() || DEFAULT_CUSTOM_TEMPLATE,
        activeTemplateId: id,
      })
      setMessage(`已切换到 ${saved.name || "未命名方案"}`)
      return
    }
    props.updateSettings({ appId: value as AppId, activeTemplateId: undefined })
    setMessage(`已切换到 ${appPreset(value as AppId).name}`)
  }

  function targetPicker(key: string) {
    return (
      <Picker key={key} title="播放器" value={pickerValue} onChanged={(value: string) => changeAppValue(value)}>
        {appOptions.map(item => (
          <Text key={item.tag} tag={item.tag}>
            {item.label}
          </Text>
        ))}
      </Picker>
    )
  }

  function exitSelecting() {
    setSelecting(false)
    setPicked([])
  }

  function toggleTagPick(tag: string) {
    const ids = tagServersOf(tag).map(item => item.id)
    if (ids.length === 0) return
    setPicked(current => {
      const allOn = ids.every(id => current.indexOf(id) >= 0)
      if (allOn) return current.filter(id => ids.indexOf(id) < 0)
      const merged = current.slice()
      for (const id of ids) if (merged.indexOf(id) < 0) merged.push(id)
      return merged
    })
    expandGroupsPicking([tag])
  }

  function invertPick() {
    const set = new Set(picked)
    setPicked(visible.filter(item => !set.has(item.id)).map(item => item.id))
  }

  function openTagAssign() {
    if (picked.length === 0) return
    Navigation.present<TagAssignResult>({
      element: <TagAssignView tags={tagOptions.map(item => item.tag)} count={picked.length} />,
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (!result || result.tags.length === 0) return
        const next = applyTagsTo(serversRef.current, picked, result.tags, result.add)
        write(next, groupsRef.current)
        setMessage(
          `${result.add ? "已给" : "已从"} ${picked.length} 台${result.add ? "添加" : "移除"}标签 ${result.tags.join(" ")}`
        )
      })
      .catch(error => setMessage(`分配标签失败 ${errorText(error)}`))
  }

  function applySort(key: SortKey, descending: boolean) {
    props.updateSettings({ librarySort: key, librarySortDesc: descending })
  }

  function openSortPicker() {
    Navigation.present({
      element: (
        <SortPickerView
          sort={settingsRef.current.librarySort}
          descending={settingsRef.current.librarySortDesc}
          onPick={applySort}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(() => setMessage(`已按${SORT_LABELS[settingsRef.current.librarySort]}排序`))
      .catch(error => setMessage(`排序设置失败 ${errorText(error)}`))
  }

  function write(servers: LibraryServer[], groups: LibraryGroup[]) {
    serversRef.current = servers
    groupsRef.current = groups
    const ok = props.writeLibrary(servers, groups)
    if (!ok) setMessage("写入本机存储失败 重启后本次改动会丢失")
    return ok
  }

  function nameClash(name: string, exceptId: string): string {
    const key = String(name || "").trim().toLowerCase()
    if (!key) return ""
    const hit = serversRef.current.some(
      item => item.id !== exceptId && String(item.name || "").trim().toLowerCase() === key
    )
    return hit ? `已有同名服务器 ${String(name).trim()} 请改用其他名称` : ""
  }

  function openEditor(server: LibraryServer) {
    const target = appPreset(settingsRef.current.appId)
    Navigation.present<EditorResult>({
      element: (
        <EntryEditorView
          server={toSubscriptionServer(server)}
          title="编辑服务器"
          appName={target.name}
          icon={server.icon}
          groupId={server.groupId}
          tags={server.tags}
          knownTags={tagOptions.map(item => item.tag)}
          iconLibraries={props.iconLibraries}
          groups={groupsRef.current}
          validate={next => nameClash(next.name, server.id)}
          buildPreview={next => buildURL(next, target, settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE)}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (!result) return
        const next = serversRef.current.map(item =>
          item.id === server.id
            ? {
                ...item,
                name: result.name,
                type: result.type,
                address: result.address,
                account: result.account,
                password: result.password,
                remark: result.remark || "",
                lines: result.lines,
                icon: result.icon || "",
                groupId: result.groupId || "",
                tags: normalizeTags(result.tags || []),
                updatedAt: Date.now(),
              }
            : item
        )
        write(next, groupsRef.current)
        setMessage(`已更新 ${result.name || server.name}`)
      })
      .catch(error => setMessage(`编辑失败 ${errorText(error)}`))
  }

  function createServer() {
    const target = appPreset(settingsRef.current.appId)
    Navigation.present<EditorResult>({
      element: (
        <EntryEditorView
          server={{ name: "", type: "emby", address: "", account: "", password: "", lines: [] }}
          title="新建服务器"
          appName={target.name}
          icon=""
          groupId={groupsRef.current.length === 1 ? groupsRef.current[0].id : ""}
          knownTags={tagOptions.map(item => item.tag)}
          iconLibraries={props.iconLibraries}
          groups={groupsRef.current}
          validate={next => nameClash(next.name, "")}
          buildPreview={next => buildURL(next, target, settingsRef.current.customTemplate || DEFAULT_CUSTOM_TEMPLATE)}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (!result) return
        const item: LibraryServer = {
          ...fromSubscriptionServer(result, { id: newServerId(), at: Date.now() }),
          icon: result.icon || "",
          groupId: result.groupId || "",
          tags: normalizeTags(result.tags || []),
        }
        write([...serversRef.current, item], groupsRef.current)
        setMessage(`已新增 ${item.name}`)
      })
      .catch(error => setMessage(`新建失败 ${errorText(error)}`))
  }

  function removeServer(id: string) {
    const list = serversRef.current
    const index = list.findIndex(item => item.id === id)
    if (index < 0) return
    const removed = list[index]
    write(
      list.filter(item => item.id !== id),
      groupsRef.current
    )
    setPicked(current => current.filter(item => item !== id))
    setUndo({ server: removed, index })
    setMessage(`已删除 ${removed.name || removed.address}`)
  }

  function restoreUndo() {
    if (!undo) return
    const next = serversRef.current.slice()
    next.splice(Math.min(undo.index, next.length), 0, undo.server)
    write(next, groupsRef.current)
    setUndo(null)
    setMessage(`已撤销删除 恢复 ${undo.server.name || undo.server.address}`)
  }

  function removePicked() {
    if (picked.length === 0) return
    const removed = new Set(picked)
    Dialog.confirm({
      title: `删除所选 ${picked.length} 台？`,
      message: "只删媒体库里的条目，导入记录不受影响。",
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
      .then(confirmed => {
        if (!confirmed) return
        write(serversRef.current.filter(item => !removed.has(item.id)), groupsRef.current)
        setPicked([])
        setMessage(`已删除 ${picked.length} 台`)
      })
      .catch(error => setMessage(`删除失败 ${errorText(error)}`))
  }

  function createGroup() {
    Navigation.present<GroupNameResult>({
      element: <GroupNameView title="新建分组" value="" />,
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        console.log("createGroup result", result)
        if (!result) return
        if (groupsRef.current.some(item => item.name === result.name)) {
          setMessage(`已有同名分组 ${result.name}`)
          return
        }
        const group = { id: newServerId(), name: result.name }
        write(serversRef.current, [...groupsRef.current, group])
        setOpenGroups(current => current.concat(group.id))
        setMessage(`已新建分组 ${group.name}`)
      })
      .catch(error => setMessage(`新建分组失败 ${errorText(error)}`))
  }

  function renameGroup(group: LibraryGroup) {
    Navigation.present<GroupNameResult>({
      element: <GroupNameView title={`重命名「${group.name}」`} value={group.name} />,
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        console.log("renameGroup result", group.id, result)
        if (!result) return
        if (result.name === group.name) {
          setMessage(`分组名未变化`)
          return
        }
        write(
          serversRef.current,
          groupsRef.current.map(item => (item.id === group.id ? { ...item, name: result.name } : item))
        )
        setMessage(`分组名已改为 ${result.name}`)
      })
      .catch(error => setMessage(`改名失败 ${errorText(error)}`))
  }

  function removeGroup(group: LibraryGroup) {
    const inside = serversRef.current.filter(item => item.groupId === group.id).length
    const next = dropGroup(serversRef.current, groupsRef.current, group.id)
    if (!write(next.servers, next.groups)) return
    setOpenGroups(current => current.filter(key => key !== group.id))
    setMessage(`已删除分组 ${group.name} ${inside} 台退回默认分组`)
  }

  function moveServersToGroup(ids: string[]) {
    if (ids.length === 0) return
    const options = groupsRef.current.map(item => item.name)
    const labels = [ROOT_GROUP_LABEL, ...options, "新建分组并移入"]
    Dialog.actionSheet({
      title: ids.length > 1 ? `把所选 ${ids.length} 台移到哪组？` : "移到哪组？",
      actions: labels.map(label => ({ label })),
      cancelButton: true,
    })
      .then(choice => {
        if (choice === null) return
        if (choice === 0) {
          moveToGroup("")
          return
        }
        if (choice === labels.length - 1) {
          Dialog.prompt({ title: "新建分组", placeholder: "分组名称", confirmLabel: "创建", cancelLabel: "取消" })
            .then(name => {
              const trimmed = (name || "").trim()
              if (!trimmed) return
              const group = { id: newServerId(), name: trimmed }
              if (write(serversRef.current, [...groupsRef.current, group])) moveToGroup(group.id, ids)
            })
            .catch(error => setMessage(`新建分组失败 ${errorText(error)}`))
          return
        }
        const group = groupsRef.current[choice - 1]
        if (group) moveToGroup(group.id, ids)
      })
      .catch(error => setMessage(`移动失败 ${errorText(error)}`))

    function moveToGroup(groupId: string, list = ids) {
      const set = new Set(list)
      write(
        serversRef.current.map(item => (set.has(item.id) ? { ...item, groupId } : item)),
        groupsRef.current
      )
      const label = groupId ? groupNameOf(groupId) : ROOT_GROUP_LABEL
      setMessage(`已把 ${list.length} 台移到 ${label}`)
    }
  }

  function yieldToPaint(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(() => resolve(), 60))
  }

  async function importJSON() {
    try {
      setMessage("正在打开文件选择")
      await yieldToPaint()
      const paths = await DocumentPicker.pickFiles({ allowsMultipleSelection: true, types: ["public.json", "public.text"] })
      if (!paths || paths.length === 0) return
      const texts: string[] = []
      for (const path of paths) {
        try {
          texts.push(await FileManager.readAsString(path))
        } catch (error) {
          setMessage(`读取文件失败 ${errorText(error)}`)
        }
      }
      const backups: BackupContent[] = []
      let incoming: LibraryServer[] = []
      for (const text of texts) {
        if (isBackupJSON(text)) {
          const content = parseBackupJSON(text)
          if (content) backups.push(content)
          continue
        }
        const parsed = parseAfusektJSON(text)
        if (parsed) incoming = incoming.concat(parsed)
      }
      if (backups.length === 0 && incoming.length === 0) {
        setMessage("所选文件不是本脚本的备份 也不是 afusekt 列表")
        return
      }
      if (incoming.length > 0) {
        const seeds = incoming.map(item => ({ ...item, id: newServerId() }))
        const result = upsertServers(serversRef.current, seeds, Date.now())
        write(result.list, groupsRef.current)
        setMessage(`已导入 新增 ${result.added} 台 更新 ${result.updated} 台`)
      }
      if (backups.length > 0) restoreBackup(backups)
    } catch (error) {
      setMessage(`导入失败 ${errorText(error)}`)
    }
  }

  function restoreBackup(contents: BackupContent[]) {
    const totals = contents.reduce(
      (acc, item) => ({
        servers: acc.servers + item.servers.length,
        groups: acc.groups + item.groups.length,
        templates: acc.templates + item.templates.length,
        libraries: acc.libraries + item.iconLibraries.length,
      }),
      { servers: 0, groups: 0, templates: 0, libraries: 0 }
    )
    Dialog.actionSheet({
      title: `备份内容：服务器 ${totals.servers} 台 / 分组 ${totals.groups} 个 / 方案 ${totals.templates} 套 / 图标库 ${totals.libraries} 个`,
      actions: [{ label: "合并到当前数据" }, { label: "替换当前数据" }],
      cancelButton: true,
    })
      .then(choice => {
        if (choice === null) return
        if (choice === 0) {
          apply(contents, false)
          return
        }
        Dialog.confirm({
          title: "替换当前数据？",
          message: `当前 ${serversRef.current.length} 台服务器、${groupsRef.current.length} 个分组与 ${templatesRef.current.length} 套方案将被备份内容覆盖。`,
          cancelLabel: "取消",
          confirmLabel: "替换",
        })
          .then(confirmed => {
            if (confirmed) apply(contents, true)
          })
          .catch(error => setMessage(`恢复失败 ${errorText(error)}`))
      })
      .catch(error => setMessage(`恢复失败 ${errorText(error)}`))

    function apply(list: BackupContent[], replace: boolean) {
      let servers = replace ? [] : serversRef.current
      let groups = replace ? [] : groupsRef.current
      let templates = replace ? [] : templatesRef.current
      let libraries = replace ? [] : iconLibrariesRef.current
      let added = 0
      let updated = 0
      let schemes = 0
      let libraryCount = 0
      for (const content of list) {
        const merged = mergeBackup(servers, groups, content)
        servers = merged.servers
        groups = merged.groups
        added += merged.added
        updated += merged.updated
        const nextTemplates = mergeTemplates(templates, content.templates)
        templates = nextTemplates.list
        schemes += nextTemplates.added
        const nextLibraries = mergeIconLibraries(libraries, content.iconLibraries)
        libraries = nextLibraries.list
        libraryCount += nextLibraries.added
      }
      if (!write(servers, groups)) return
      props.writeTemplates(templates)
      props.writeIconLibraries(libraries)
      setMessage(
        `已${replace ? "替换" : "合并"}备份 共 ${servers.length} 台 新增 ${added} 更新 ${updated} 分组 ${groups.length} 方案新增 ${schemes} 图标库新增 ${libraryCount}`
      )
    }
  }

  function backupFileName(): string {
    const date = new Date()
    const pad = (value: number) => (value < 10 ? `0${value}` : String(value))
    return `EmbyLibraryKit-备份-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`
  }

  async function exportBackup() {
    try {
      const text = buildBackupJSON(
        serversRef.current,
        groupsRef.current,
        templatesRef.current,
        iconLibrariesRef.current,
        Script.metadata.version || ""
      )
      const data = Data.fromString(text)
      if (!data) {
        setMessage("生成备份内容失败")
        return
      }
      setMessage("正在打开保存位置")
      await yieldToPaint()
      const saved = await DocumentPicker.exportFiles({ files: [{ data, name: backupFileName() }] })
      setMessage(
        saved.length > 0
          ? `已导出备份 ${serversRef.current.length} 台 ${groupsRef.current.length} 个分组 ${templatesRef.current.length} 套方案 ${iconLibrariesRef.current.length} 个图标库 含密码请妥善保管`
          : "未选择保存位置 已取消导出"
      )
    } catch (error) {
      setMessage(`导出备份失败 ${errorText(error)}`)
    }
  }

  function exportFileName(count: number): string {
    const date = new Date()
    const pad = (value: number) => (value < 10 ? `0${value}` : String(value))
    return `media-library-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${count}台.json`
  }

  async function exportList(list: LibraryServer[]) {
    if (list.length === 0) {
      setMessage("没有可导出的服务器")
      return
    }
    try {
      const text = toAfusektJSON(list)
      const data = Data.fromString(text)
      if (!data) {
        setMessage("生成文件内容失败")
        return
      }
      setMessage("正在打开保存位置")
      await yieldToPaint()
      const saved = await DocumentPicker.exportFiles({ files: [{ data, name: exportFileName(list.length) }] })
      setMessage(saved.length > 0 ? `已导出 ${list.length} 台 文件 ${saved[0].split("/").pop()}` : "未选择保存位置 已取消导出")
    } catch (error) {
      setMessage(`导出失败 ${errorText(error)}`)
    }
  }

  function exportJSON() {
    exportList(serversRef.current)
  }

  function buildQueue(servers: LibraryServer[]): BatchItem[] {
    const items: BatchItem[] = []
    for (const server of servers) {
      const convertible = toSubscriptionServer(server)
      if (!convertible.address) continue
      const chosen = resolveTarget(targetTag)
      items.push({
        id: `${server.id}|${targetTag}`,
        raw: buildURL(convertible, chosen.preset, chosen.template),
        label: `${server.name || convertible.address} → ${appLabel(targetTag)}`,
      })
    }
    return items
  }

  async function openLink(item: BatchItem): Promise<boolean> {
    try {
      const opened = await Safari.openURL(item.raw)
      if (opened) {
        const record: HistoryRecord = {
          id: item.id,
          title: "",
          host: item.raw,
          account: "",
          type: "",
          app: appNameForRaw(item.raw, appPreset(settingsRef.current.appId).name),
          raw: item.raw,
          at: Date.now(),
        }
        const server = serversRef.current.find(item2 => item.id.startsWith(`${item2.id}|`))
        if (server) {
          record.title = server.name
          record.account = server.account
          record.type = server.type
          record.host = server.address.replace(/^https?:\/\//, "")
        }
        const next = [record, ...historyRef.current.filter(existing => existing.raw !== record.raw)]
        historyRef.current = next
        props.writeHistory(next)
      }
      return opened
    } catch (error) {
      console.log("openURL failed", item.raw, error)
      return false
    }
  }

  async function startImport(servers: LibraryServer[]) {
    const queue = buildQueue(servers)
    if (queue.length === 0) {
      setMessage("所选服务器都没有主机地址")
      return
    }
    runningRef.current = true
    setStatus("running")
    setWaiting(false)
    setProgress({ done: 0, total: queue.length, current: "" })

    const outcome = await runBatch(
      queue,
      {
        isCancelled: () => !runningRef.current,
        onProgress: (done, total, current) => setProgress({ done, total, current }),
        between: async (_item, _index, opened) => {
          if (!opened) return
          setWaiting(true)
          await waitForReturn(() => !runningRef.current)
          setWaiting(false)
        },
      },
      item => openLink(item)
    )

    setWaiting(false)
    runningRef.current = false
    setStatus("idle")
    const summary = summarizeBatch(outcome)
    setMessage(summary)
    if (settingsRef.current.notify) {
      try {
        await Notification.schedule({
          title: "媒体库批量导入",
          body: outcome.failed > 0 ? `${summary}。失败：${outcome.failures.slice(0, 3).join("、")}` : summary,
          silent: false,
        })
      } catch (error) {
        console.log("notify failed", error)
      }
    }
  }

  function stopImport() {
    runningRef.current = false
    requestContinue()
    setWaiting(false)
    setStatus("idle")
    setMessage("正在停止")
  }

  function importOne(server: LibraryServer) {
    const convertible = toSubscriptionServer(server)
    if (!convertible.address) {
      setMessage("缺少主机地址 打开后补全再导入")
      return
    }
    const chosen = resolveTarget(targetTag)
    const raw = buildURL(convertible, chosen.preset, chosen.template)
    const label = appLabel(targetTag)
    openLink({ id: `${server.id}|${targetTag}`, raw, label: `${server.name || convertible.address} → ${label}` })
      .then(opened =>
        setMessage(opened ? `已打开 ${label} 请在应用内确认导入` : `无法打开 ${raw.slice(0, 60)}`)
      )
      .catch(error => setMessage(`打开失败 ${errorText(error)}`))
  }

  const filtering = tagFilter.length > 0 || keyword.length > 0
  const groupSections = useMemo(() => {
    const groupIds = new Set(props.groups.map(group => group.id))
    const sections: Array<{ key: string; title: string; servers: LibraryServer[] }> = [
      { key: "root", title: ROOT_GROUP_LABEL, servers: [] },
    ]
    for (const group of props.groups) sections.push({ key: group.id, title: group.name, servers: [] })
    const sectionMap = new Map(sections.map(section => [section.key, section]))
    for (const server of visible) {
      const section = sectionMap.get(groupIds.has(server.groupId) ? server.groupId : "root")
      if (section) section.servers.push(server)
    }
    return sections
  }, [props.groups, visible])

  const results = visible

  function toggleGroup(key: string) {
    setOpenGroups(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]))
  }

  function togglePick(id: string) {
    setPicked(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))
  }

  function rowFor(server: LibraryServer, showGroup: boolean) {
    return (
      <ServerRow
        key={server.id}
        server={server}
        groupName={showGroup ? groupNameOf(server.groupId) : ""}
        disabled={status === "running"}
        selectable={selecting}
        selected={picked.includes(server.id)}
        onToggle={() => togglePick(server.id)}
        onEdit={() => openEditor(server)}
        importTitle={`导入 ${appLabel(targetTag)}`}
        onImport={() => importOne(server)}
        onDelete={() => removeServer(server.id)}
        latency={latencies[server.id]}
      />
    )
  }

  function groupHeader(section: { key: string; title: string; servers: LibraryServer[] }) {
    const group = props.groups.find(item => item.id === section.key)
    const actions = group
      ? [
          <Button key="rename" title="重命名" action={() => renameGroup(group)} />,
          <Button key="delete" title="删除分组" role="destructive" action={() => removeGroup(group)} />,
        ]
      : []
    return (
      <HStack
        key={`group-${section.key}`}
        spacing={8}
        trailingSwipeActions={{ allowsFullSwipe: false, actions }}
        contentShape={{ kind: "interaction", shape: "rect" }}
        onTapGesture={() => toggleGroup(section.key)}
      >
        <Image
          systemName={openGroups.includes(section.key) ? "chevron.down" : "chevron.right"}
          font={13}
          foregroundStyle="secondaryLabel"
        />
        <Text bold={true} lineLimit={1}>{`${section.title}（${section.servers.length}）`}</Text>
        <Spacer />
      </HStack>
    )
  }

  function groupRows(): VirtualNode[] {
    const rows: VirtualNode[] = []
    for (const section of groupSections) {
      rows.push(groupHeader(section))
      if (openGroups.includes(section.key)) {
        for (const server of section.servers) rows.push(rowFor(server, false))
      }
    }
    return rows
  }

  const nonePicked = picked.length === 0
  const listHeader = (
    <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <Text>{searching ? "搜索结果" : "分组"}</Text>
      <Spacer />
      <Text
        font="caption"
        foregroundStyle={SUCCESS_TEXT}
        contentShape={{ kind: "interaction", shape: "rect" }}
        onTapGesture={createGroup}
      >
        新建
      </Text>
      <Text
        font="caption"
        foregroundStyle={ACCENT_TEXT}
        contentShape={{ kind: "interaction", shape: "rect" }}
        onTapGesture={openSortPicker}
      >
        {`排序：${SORT_LABELS[props.settings.librarySort]} · ${props.settings.librarySortDesc ? "递减" : "递增"} ›`}
      </Text>
    </HStack>
  )
  const batchRows = selecting ? (
    <Section header={<Text>{`多选（已选 ${picked.length} 台）`}</Text>}>
      {targetPicker("batch")}
      <TagGroup items={pickTagItems} empty="还没有标签：在编辑服务器的「标签」里填几个，就能在这里一次勾选一整组。" />
      <HStack spacing={10}>
        <PillButton title={`全选（${visible.length}）`} action={() => setPicked(visible.map(item => item.id))} />
        <PillButton title="反选" action={invertPick} />
        <PillButton title="清空" disabled={nonePicked} action={() => setPicked([])} />
      </HStack>
      <HStack spacing={10}>
        <PillButton
          title={`导入 ${appLabel(targetTag)}（${picked.length}）`}
          disabled={nonePicked || status === "running"}
          action={() => startImport(pickedServers)}
        />
        <PillButton
          title={`导出JSON（${picked.length}）`}
          color={SUCCESS}
          disabled={nonePicked}
          action={() => exportList(pickedServers)}
        />
      </HStack>
      <HStack spacing={10}>
        <PillButton title="移到分组" disabled={nonePicked} action={() => moveServersToGroup(picked)} />
        <PillButton title="分配标签" disabled={nonePicked} action={openTagAssign} />
        <PillButton title={`删除（${picked.length}）`} color={DANGER} disabled={nonePicked} action={removePicked} />
      </HStack>
    </Section>
  ) : null

  return (
      <List
        navigationTitle={searching ? "搜索服务器" : "媒体库"}
        navigationBarTitleDisplayMode="inline"
        toast={{
          isPresented: toastOn,
          onChanged: setToastOn,
          message,
          duration: 3,
          position: "top",
        }}
        {...(searching
          ? {
              searchable: {
                value: search,
                onChanged: setSearch,
                placement: "navigationBarDrawerAlwaysDisplay",
                prompt: "名称 / 主机 / 账号 / 分组 / 标签 / 线路",
              },
            }
          : {})}
        toolbar={{
          topBarLeading: selecting ? (
            <Button title="" systemImage="checkmark" action={exitSelecting} />
          ) : (
            <Button title="" systemImage="xmark" action={dismiss} />
          ),
          topBarTrailing: [
            ...(searching ? [] : [<Button key="add" title="" systemImage="plus" action={createServer} />]),
            <Menu key="more" title="" systemImage="ellipsis.circle">
              {selecting ? null : <Button title="高级" action={() => setSelecting(true)} />}
              <Button title={`导出 JSON（${props.servers.length}）`} disabled={props.servers.length === 0} action={exportJSON} />
              <Button title="导入 JSON/备份" action={() => importJSON().catch(error => setMessage(`导入失败 ${errorText(error)}`))} />
              <Button
                title="导出备份"
                disabled={props.servers.length === 0}
                action={() => exportBackup().catch(error => setMessage(`导出备份失败 ${errorText(error)}`))}
              />
            </Menu>,
          ],
        }}
      >
        {searching ? (
          <Section header={<Text>{`匹配 ${results.length} / 共 ${props.servers.length} 台`}</Text>}>
            {keyword && results.length === 0 ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                没有匹配的服务器，换个关键字试试。
              </Text>
            ) : null}
            {keyword ? null : (
              <Text font="caption" foregroundStyle="secondaryLabel">
                在上方搜索栏输入关键字，按名称 / 主机 / 账号 / 类型 / 分组 / 标签 / 线路匹配；左滑一条可直接编辑参数或导入。
              </Text>
            )}
          </Section>
        ) : (
          <Section header={<Text>库</Text>}>
            <HStack>
              <Text>媒体服务器</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{`${props.servers.length} 台`}</Text>
            </HStack>
            {props.notice ? (
              <Text font="caption" foregroundStyle={SUCCESS_TEXT}>
                {props.notice}
              </Text>
            ) : null}
            {undo ? (
              <HStack spacing={10}>
                <PillButton title="撤销删除" color={SUCCESS} action={restoreUndo} />
                <PillButton title="关闭提示" action={() => setUndo(null)} />
              </HStack>
            ) : null}
          </Section>
        )}

        {tagOptions.length > 0 && !selecting ? (
          <Section
            header={
              <HStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text>标签筛选</Text>
                <Spacer />
                <Text
                  font="caption"
                  foregroundStyle={ACCENT_TEXT}
                  contentShape={{ kind: "interaction", shape: "rect" }}
                  onTapGesture={() => {
                    if (tagEditing) {
                      setTagEditing(false)
                      setSortingTag("")
                      return
                    }
                    if (tagFilter.length > 0) {
                      clearTagFilter()
                      return
                    }
                    setTagEditing(true)
                  }}
                >
                  {tagEditing ? "完成" : tagFilter.length > 0 ? "清除筛选" : "编辑"}
                </Text>
              </HStack>
            }
          >
            <TagGroup items={filterTagItems} editing={tagEditing} onRemove={deleteTag} pickedLabel={sortingTag} />
          </Section>
        ) : null}

        {!selecting ? <Section>{targetPicker("filter")}</Section> : null}

        {batchRows}

        {status === "running" ? (
          <Section header={<Text>导入进度</Text>}>
            <PillButton title="停止" color={DANGER} action={stopImport} />
            {waiting ? <PillButton title="立即下一条" action={() => requestContinue()} /> : null}
            {progress.total > 0 ? (
              <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
                <HStack>
                  <Text font="caption" foregroundStyle="secondaryLabel">{`${progress.done} / ${progress.total}`}</Text>
                  <Spacer />
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {waiting ? "等待你回到本页…（最多 10 秒）" : progress.current}
                  </Text>
                </HStack>
              </VStack>
            ) : null}
          </Section>
        ) : null}

        <Section header={listHeader}>{searching ? results.map(server => rowFor(server, true)) : groupRows()}</Section>

        {!searching && filtering && visible.length === 0 ? (
          <Section header={<Text>没有命中的服务器</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel">
              当前标签与关键字下没有服务器，可点右上角的清除筛选或换个关键字。
            </Text>
          </Section>
        ) : null}

        {!searching && props.servers.length === 0 ? (
          <Section header={<Text>暂无服务器</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel">
              点右上角 + 手工填一台，或到「解析」标签粘贴链接 / 订阅 JSON / 开通通知后勾几条再点「添加到媒体库」，也可以用「导入 JSON」读小幻影视导出的那份格式。
            </Text>
          </Section>
        ) : null}
      </List>
  )
}
