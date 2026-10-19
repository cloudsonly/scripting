import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"
import type { IconLibraryContent } from "../iconLibrary"
import { filterIcons, iconFallbackName, loadIconLibrary } from "../iconLibrary"
import type { SavedIconLibrary } from "../store"
import { IconGrid } from "./IconGrid"
import { PillButton } from "./PillButton"

const PAGE = 60

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function IconLibraryView(props: {
  libraries: SavedIconLibrary[]
  writeLibraries: (list: SavedIconLibrary[]) => boolean
}) {
  const dismiss = Navigation.useDismiss()
  const [list, setList] = useState<SavedIconLibrary[]>(props.libraries)
  const [openId, setOpenId] = useState("")
  const [content, setContent] = useState<IconLibraryContent | null>(null)
  const [keyword, setKeyword] = useState("")
  const [limit, setLimit] = useState(PAGE)
  const [status, setStatus] = useState("")

  const active = list.find(item => item.id === openId)

  function persist(next: SavedIconLibrary[], note: string) {
    setList(next)
    if (!props.writeLibraries(next)) setStatus(`写入本机存储失败 ${note}`)
    else setStatus(note)
  }

  function addLibrary() {
    Dialog.prompt({
      title: "添加图标库",
      placeholder: "图标库 JSON 地址（https://…/Icon.json）",
      confirmLabel: "添加并读取",
      cancelLabel: "取消",
    })
      .then(input => {
        const url = (input || "").trim()
        if (!url) return
        if (list.some(item => item.url === url)) {
          setStatus("该地址已在列表里")
          return
        }
        setStatus("正在读取图标库")
        loadIconLibrary(url, true)
          .then(result => {
            const entry: SavedIconLibrary = {
              id: `ic-${Date.now()}`,
              url,
              name: result.name || iconFallbackName(url),
              count: result.icons.length,
              addedAt: Date.now(),
            }
            persist(list.concat(entry), `已添加 ${entry.name} 共 ${entry.count} 个图标`)
          })
          .catch(error => setStatus(`读取图标库失败 ${errorText(error)}`))
      })
      .catch(error => setStatus(`添加图标库失败 ${errorText(error)}`))
  }

  function copyURL(url: string, label: string) {
    Pasteboard.setString(url)
      .then(() => setStatus(`已复制${label}`))
      .catch(error => setStatus(`复制失败 ${errorText(error)}`))
  }

  function refreshLibrary(item: SavedIconLibrary) {
    setStatus(`正在读取 ${item.name}`)
    loadIconLibrary(item.url, true)
      .then(result => {
        const name = result.name || item.name
        persist(
          list.map(existing => (existing.id === item.id ? { ...existing, name, count: result.icons.length } : existing)),
          `「${name}」现有 ${result.icons.length} 个图标。`
        )
        if (item.id === openId) setContent(result)
      })
      .catch(error => setStatus(`刷新失败 ${errorText(error)}`))
  }

  function removeLibrary(item: SavedIconLibrary) {
    persist(
      list.filter(existing => existing.id !== item.id),
      `已移除 ${item.name} 服务器里的图标地址不变`
    )
    setOpenId("")
    setContent(null)
  }

  function openLibrary(item: SavedIconLibrary) {
    setOpenId(item.id)
    setContent(null)
    setKeyword("")
    setLimit(PAGE)
    setStatus("正在读取图标库")
    loadIconLibrary(item.url, false)
      .then(result => {
        setContent(result)
        setStatus("")
      })
      .catch(error => setStatus(`读取失败 ${errorText(error)}`))
  }

  if (active) {
    const shown = content ? filterIcons(content.icons, keyword) : []
    const visible = shown.slice(0, limit)
    const rest = shown.length - visible.length
    return (
      <NavigationStack>
        <List
          navigationTitle={active.name}
          navigationBarTitleDisplayMode="inline"
          toolbar={{
            cancellationAction: <Button title="图标库" systemImage="chevron.left" action={() => setOpenId("")} />,
            confirmationAction: <Button title="完成" action={dismiss} />,
          }}
        >
          <Section header={<Text>筛选</Text>}>
            <TextField
              title="关键字"
              prompt={`共 ${content ? content.icons.length : 0} 个图标，输入一点字就能找到`}
              value={keyword}
              onChanged={value => {
                setKeyword(value)
                setLimit(PAGE)
              }}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            />
            {status ? (
              <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
                {status}
              </Text>
            ) : null}
            {content && content.description ? (
              <Text font="caption2" foregroundStyle="tertiaryLabel" multilineTextAlignment="leading">
                {content.description}
              </Text>
            ) : null}
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              点一个图标即复制它的图片地址，可直接粘到别处或填进服务器的「图标」。
            </Text>
            <HStack spacing={10}>
              <PillButton title="刷新" action={() => refreshLibrary(active)} />
              <PillButton title="复制库地址" action={() => copyURL(active.url, "图标库地址")} />
            </HStack>
          </Section>

          <Section header={<Text>{`${keyword ? "匹配" : "全部"} ${shown.length} 个${rest > 0 ? ` · 已显示 ${visible.length} 个` : ""}`}</Text>}>
            {shown.length === 0 && !status ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                没有匹配的图标，换个关键字试试。
              </Text>
            ) : (
              <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <IconGrid icons={visible} onPick={icon => copyURL(icon.url, `图标 ${icon.name} 地址`)} />
                {rest > 0 ? (
                  <PillButton title={`再显示 ${PAGE} 个（剩余 ${rest} 个）`} action={() => setLimit(limit + PAGE)} />
                ) : null}
              </VStack>
            )}
          </Section>
        </List>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="图标库"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          confirmationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        <Section header={<Text>已添加</Text>}>
          <PillButton title="添加图标库" action={addLibrary} />
          {list.length === 0 ? (
            <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
              还没有图标库。添加一份图标库 JSON 的地址（顶层含 name 与 icons 数组），读取成功后这里会显示库名与图标数量。
            </Text>
          ) : (
            list.map(item => (
              <HStack
                key={item.id}
                spacing={10}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button key="copy" title="复制地址" action={() => copyURL(item.url, "图标库地址")} />,
                    <Button key="refresh" title="刷新" action={() => refreshLibrary(item)} />,
                    <Button key="delete" title="移除" role="destructive" action={() => removeLibrary(item)} />,
                  ],
                }}
              >
                <VStack
                  alignment="leading"
                  spacing={2}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  contentShape={{ kind: "interaction", shape: "rect" }}
                  onTapGesture={() => openLibrary(item)}
                >
                  <Text bold={true} lineLimit={1}>
                    {item.name || iconFallbackName(item.url)}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} truncationMode="middle">
                    {`${item.count > 0 ? `${item.count} 个图标 · ` : ""}${item.url}`}
                  </Text>
                </VStack>
                <Image systemName="chevron.right" font={13} foregroundStyle="tertiaryLabel" />
              </HStack>
            ))
          )}
        </Section>

        {status ? (
          <Section header={<Text>状态</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
              {status}
            </Text>
          </Section>
        ) : null}
      </List>
    </NavigationStack>
  )
}
