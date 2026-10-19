import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  useState,
} from "scripting"
import type { SchemeEntry } from "../parse"
import { maskSecrets } from "../parse"
import type { SubscriptionLine, SubscriptionServer } from "../subscription"
import { serverFromEntry, splitAddress } from "../subscription"
import type { LibraryGroup } from "../library"
import { normalizeTags } from "../library"
import { PillButton } from "./PillButton"
import { ACCENT_TEXT, DANGER, DANGER_TEXT } from "./tokens"
import type { IconPickResult } from "./IconPickerView"
import IconPickerView from "./IconPickerView"
import type { SavedIconLibrary } from "../store"
import { TagGroup } from "./TagChip"
import type { LineOrderResult } from "./LineOrderView"
import LineOrderView from "./LineOrderView"

const EYE_HIT = { kind: "interaction", shape: "rect" } as const
const SCHEME_HEAD = /^[A-Za-z][A-Za-z0-9+.\-]*:\/\//

function Field(props: { label: string; value: string; placeholder?: string; onChanged: (value: string) => void }) {
  return (
    <HStack>
      <Text>{props.label}</Text>
      <TextField
        title=""
        prompt={props.placeholder}
        value={props.value}
        onChanged={props.onChanged}
        frame={{ maxWidth: "infinity" }}
        multilineTextAlignment="trailing"
      />
    </HStack>
  )
}

function SecretField(props: { label: string; value: string; placeholder?: string; onChanged: (value: string) => void }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <HStack spacing={8}>
      <Text>{props.label}</Text>
      {revealed ? (
        <TextField
          title=""
          prompt={props.placeholder}
          value={props.value}
          onChanged={props.onChanged}
          frame={{ maxWidth: "infinity" }}
          multilineTextAlignment="trailing"
        />
      ) : (
        <Text
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          frame={{ maxWidth: "infinity", alignment: "trailing" }}
        >
          {props.value ? "•".repeat(props.value.length) : props.placeholder || ""}
        </Text>
      )}
      <Image
        systemName={revealed ? "eye.slash" : "eye"}
        font={17}
        foregroundStyle={ACCENT_TEXT}
        padding={4}
        contentShape={EYE_HIT}
        onTapGesture={() => setRevealed(!revealed)}
      />
    </HStack>
  )
}

let lineSeed = 0

export interface EditorLine extends SubscriptionLine {
  key: string
}

function LineRow(props: { line: EditorLine; onChanged: (line: SubscriptionLine) => void; onDelete: () => void }) {
  return (
    <HStack
      spacing={8}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [<Button key="delete" title="删除线路" role="destructive" action={props.onDelete} />],
      }}
    >
      <TextField
        title=""
        prompt="线路名"
        value={props.line.name}
        onChanged={value => props.onChanged({ ...props.line, name: value })}
        frame={{ width: 96 }}
      />
      <TextField
        title=""
        prompt="https://线路地址"
        value={props.line.address}
        onChanged={value => props.onChanged({ ...props.line, address: value })}
        frame={{ maxWidth: "infinity" }}
        multilineTextAlignment="trailing"
      />
    </HStack>
  )
}

export interface EditorResult extends SubscriptionServer {
  icon?: string
  groupId?: string
  tags?: string[]
}

const UNGROUPED_TAG = "__none__"

export default function EntryEditorView(props: {
  entry?: SchemeEntry
  server?: SubscriptionServer
  title: string
  appName: string
  buildPreview: (server: SubscriptionServer) => string
  icon?: string
  groups?: LibraryGroup[]
  groupId?: string
  tags?: string[]
  knownTags?: string[]
  iconLibraries?: SavedIconLibrary[]
  validate?: (result: EditorResult) => string
}) {
  const dismiss = Navigation.useDismiss()
  const initial = props.server
    ? { ...props.server }
    : (() => {
        const fromEntry = serverFromEntry(props.entry as SchemeEntry)
        if (!(props.entry as SchemeEntry).host) fromEntry.address = ""
        return fromEntry
      })()
  const split = splitAddress(initial.address)

  const [name, setName] = useState(initial.name)
  const [type, setType] = useState(initial.type || "emby")
  const [protocol, setProtocol] = useState(split.scheme || "https")
  const [host, setHost] = useState(split.host)
  const [port, setPort] = useState(split.port)
  const [path, setPath] = useState(split.path)
  const [account, setAccount] = useState(initial.account)
  const [password, setPassword] = useState(initial.password)
  const [rows, setRows] = useState<EditorLine[]>(() => initial.lines.map((line, index) => ({ key: `ln-${index}`, name: line.name, address: line.address })))
  const [remark, setRemark] = useState(initial.remark ?? "")
  const [icon, setIcon] = useState(props.icon ?? "")

  function openIconPicker() {
    Navigation.present<IconPickResult>({
      element: <IconPickerView libraries={props.iconLibraries || []} />,
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (result && result.url) setIcon(result.url)
      })
      .catch(error => console.log("打开图标库失败", error))
  }
  const [groupId, setGroupId] = useState(props.groupId || UNGROUPED_TAG)
  const [tagsText, setTagsText] = useState((props.tags || []).join(" "))

  const knownTagList = normalizeTags(props.knownTags || [])
  const currentTagList = normalizeTags(tagsText)

  function toggleKnownTag(tag: string) {
    const hit = currentTagList.some(item => item.toLowerCase() === tag.toLowerCase())
    const next = hit
      ? currentTagList.filter(item => item.toLowerCase() !== tag.toLowerCase())
      : currentTagList.concat(tag)
    setTagsText(next.join(" "))
  }
  const [revealLink, setRevealLink] = useState(false)
  const [error, setError] = useState("")

  const libraryMode = Array.isArray(props.groups)
  // 主机框里可能还残留着协议、端口、路径（手输的完整地址），拼装前再拆一次，避免写出 https://host:8096:443 这类地址
  const hostParts = splitAddress(host)
  const trimmedHost = hostParts.host
  const resolvedPort = hostParts.port || port.trim()
  const resolvedPath = hostParts.path || path.trim()
  const server: SubscriptionServer = {
    name: name.trim(),
    type: (type.trim() || "emby").toLowerCase(),
    address: trimmedHost
      ? `${protocol.trim() || hostParts.scheme || "https"}://${trimmedHost}${resolvedPort ? ":" + resolvedPort : ""}${resolvedPath}`
      : "",
    account: account.trim(),
    password,
    remark: remark.trim() || undefined,
    lines: rows.filter(row => row.address.trim()).map(row => ({ name: row.name.trim(), address: row.address.trim() })),
  }

  function changeHost(value: string) {
    if (error) setError("")
    const parts = splitAddress(value)
    // 一次进来多个字符按粘贴处理，才把端口与路径挪进各自的框；逐字输入时动不得，否则接着打会打在域名尾巴上
    if (parts.host && value.length - host.length >= 2) {
      if (parts.scheme) setProtocol(parts.scheme)
      setHost(parts.host)
      if (parts.port) setPort(parts.port)
      if (parts.path) setPath(parts.path)
      return
    }
    const scheme = SCHEME_HEAD.exec(value)
    setHost(scheme && scheme[0].length < value.length ? value.slice(scheme[0].length) : value)
  }

  function updateLine(key: string, next: SubscriptionLine) {
    setRows(current => current.map(item => (item.key === key ? { key, name: next.name, address: next.address } : item)))
  }

  function removeLine(key: string) {
    setRows(current => current.filter(item => item.key !== key))
  }

  function addLine() {
    lineSeed += 1
    setRows(current => current.concat({ key: `ln-new-${lineSeed}`, name: "", address: "" }))
  }

  function openLineOrder() {
    Navigation.present<LineOrderResult>({
      element: (
        <LineOrderView
          items={rows.map(row => ({ id: row.key, name: row.name, address: row.address }))}
        />
      ),
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (!result || !Array.isArray(result.items)) return
        setRows(result.items.map(item => ({ key: item.id, name: item.name, address: item.address })))
      })
      .catch(error => console.log("打开线路顺序失败", error))
  }
  const preview = server.address ? props.buildPreview(server) : "（缺少主机，无法生成链接）"

  function save() {
    const result: EditorResult = libraryMode
      ? ({
          ...server,
          icon: icon.trim(),
          groupId: groupId === UNGROUPED_TAG ? "" : groupId,
          tags: normalizeTags(tagsText),
        } as EditorResult)
      : (server as EditorResult)
    if (!libraryMode) {
      dismiss(result)
      return
    }
    if (!server.address) {
      setError("未填写主机 请补全后再保存")
      return
    }
    const complaint = props.validate ? props.validate(result) : ""
    if (complaint) {
      setError(complaint)
      return
    }
    dismiss(result)
  }

  const groupOptions = [{ tag: UNGROUPED_TAG, label: "默认分组" }, ...(props.groups || []).map(item => ({ tag: item.id, label: item.name }))]
  const groupValue = groupOptions.some(item => item.tag === groupId) ? groupId : UNGROUPED_TAG

  return (
    <NavigationStack>
      <List
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
          confirmationAction: <Button title="保存" action={save} />,
        }}
      >
        <Section
          header={<Text>服务器</Text>}
          footer={<Text>所有值都会自动 URL 编码后写入导入链接。主机粘完整地址（https://xx.com:8096/npo）会自动拆成协议、主机、端口与路径。</Text>}
        >
          <Field label="名称" value={name} placeholder="显示名称" onChanged={setName} />
          <Field label="类型" value={type} placeholder="emby / jellyfin" onChanged={setType} />
          <Field label="协议" value={protocol} placeholder="https" onChanged={setProtocol} />
          <Field
            label="主机"
            value={host}
            placeholder="emby.example.com"
            onChanged={changeHost}
          />
          {error ? (
            <Text font="caption" foregroundStyle={DANGER_TEXT} multilineTextAlignment="leading">
              {error}
            </Text>
          ) : null}
          <Field label="端口" value={port} placeholder="443" onChanged={setPort} />
          <Field label="路径" value={path} placeholder="/npo（选填）" onChanged={setPath} />
          <Field label="用户名" value={account} placeholder="username" onChanged={setAccount} />
          <SecretField label="密码" value={password} placeholder="password" onChanged={setPassword} />
          <Field label="备注" value={remark} placeholder="remark（选填）" onChanged={setRemark} />
          {libraryMode ? (
            <>
              <Picker title="分组" value={groupValue} onChanged={(value: string) => setGroupId(value)}>
                {groupOptions.map(item => (
                  <Text key={item.tag} tag={item.tag}>
                    {item.label}
                  </Text>
                ))}
              </Picker>
              <Field label="图标" value={icon} placeholder="https://…/icon.png（选填）" onChanged={setIcon} />
          {(props.iconLibraries || []).length > 0 ? (
            <HStack spacing={10}>
              <PillButton title="从图标库选取" action={openIconPicker} />
              {icon ? <PillButton title="清除图标" color={DANGER} action={() => setIcon("")} /> : null}
            </HStack>
          ) : null}
              {knownTagList.length > 0 ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  已有标签，点一下加入或移出
                </Text>
              ) : null}
              {knownTagList.length > 0 ? (
                <TagGroup
                  items={knownTagList.map(tag => ({
                    label: tag,
                    on: currentTagList.some(item => item.toLowerCase() === tag.toLowerCase()),
                    action: () => toggleKnownTag(tag),
                  }))}
                />
              ) : null}
              <Field label="标签" value={tagsText} placeholder="主力 CF 分流（空格分隔）" onChanged={setTagsText} />
              {tagsText.trim() ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {`已识别 ${normalizeTags(tagsText).length} 个标签`}
                </Text>
              ) : null}
            </>
          ) : null}
        </Section>

        <Section
          header={
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text>{`备用线路（${server.lines.length} 条）`}</Text>
              <Spacer />
              {rows.length > 1 ? (
                <Text
                  font="caption"
                  foregroundStyle={ACCENT_TEXT}
                  contentShape={{ kind: "interaction", shape: "rect" }}
                  onTapGesture={openLineOrder}
                >
                  排序
                </Text>
              ) : null}
            </HStack>
          }
          footer={<Text>左滑这一行删除。</Text>}
        >
          {rows.map(row => (
            <LineRow key={row.key} line={row} onChanged={next => updateLine(row.key, next)} onDelete={() => removeLine(row.key)} />
          ))}
          <PillButton title="添加线路" action={addLine} />
        </Section>


        <Section
          header={
            <HStack spacing={8}>
              <Text>生成的导入链接</Text>
              <Spacer />
              <Image
                systemName={revealLink ? "eye.slash" : "eye"}
                font={16}
                foregroundStyle={ACCENT_TEXT}
                contentShape={EYE_HIT}
                onTapGesture={() => setRevealLink(!revealLink)}
              />
            </HStack>
          }
          footer={<Text>默认把 password 的值遮成点；点眼睛看原文。真正导入用的始终是原文。</Text>}
        >
          <Text font="caption" monospaced={true} textSelection={true}>
            {revealLink ? preview : maskSecrets(preview)}
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}
