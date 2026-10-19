import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting"
import type { IconEntry, IconLibraryContent } from "../iconLibrary"
import { filterIcons, loadIconLibrary } from "../iconLibrary"
import type { SavedIconLibrary } from "../store"
import { IconGrid } from "./IconGrid"
import { PillButton } from "./PillButton"

const PAGE = 60

export interface IconPickResult {
  url: string
}


function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function IconPickerView(props: { libraries: SavedIconLibrary[] }) {
  const dismiss = Navigation.useDismiss()
  const [openId, setOpenId] = useState("")
  const [content, setContent] = useState<IconLibraryContent | null>(null)
  const [status, setStatus] = useState("")
  const [keyword, setKeyword] = useState("")
  const [limit, setLimit] = useState(PAGE)

  const active = props.libraries.find(item => item.id === openId)

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
    const shown: IconEntry[] = content ? filterIcons(content.icons, keyword) : []
    const visible = shown.slice(0, limit)
    const rest = shown.length - visible.length
    return (
      <NavigationStack>
        <List
          navigationTitle={active.name}
          navigationBarTitleDisplayMode="inline"
          toolbar={{
            cancellationAction: <Button title="图标库" systemImage="chevron.left" action={() => setOpenId("")} />,
            confirmationAction: <Button title="取消" action={dismiss} />,
          }}
        >
          <Section header={<Text>按名称或地址筛选</Text>}>
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
              <Text font="caption" foregroundStyle="secondaryLabel">
                {status}
              </Text>
            ) : null}
            {content && content.description ? (
              <Text font="caption2" foregroundStyle="tertiaryLabel" multilineTextAlignment="leading">
                {content.description}
              </Text>
            ) : null}
          </Section>

          <Section header={<Text>{`${keyword ? "匹配" : "全部"} ${shown.length} 个${rest > 0 ? ` · 已显示 ${visible.length} 个` : ""}`}</Text>}>
            {shown.length === 0 && !status ? (
              <Text font="caption" foregroundStyle="secondaryLabel">
                没有匹配的图标，换个关键字试试。
              </Text>
            ) : (
              <VStack alignment="leading" spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <IconGrid icons={visible} onPick={icon => dismiss({ url: icon.url })} />
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
        navigationTitle="从图标库选取"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          confirmationAction: <Button title="取消" action={dismiss} />,
        }}
      >
        {props.libraries.length === 0 ? (
          <Section header={<Text>图标库</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
              还没有图标库。请到「设置 → 数据 → 图标库」添加一份图标库 JSON 地址，再回到这里挑选。
            </Text>
          </Section>
        ) : (
          <Section header={<Text>图标库</Text>}>
            {props.libraries.map(item => (
              <HStack
                key={item.id}
                contentShape={{ kind: "interaction", shape: "rect" }}
                onTapGesture={() => openLibrary(item)}
              >
                <Text>{item.name}</Text>
                <Spacer />
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {`${item.count > 0 ? `${item.count} 个` : "读取"} ›`}
                </Text>
              </HStack>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}
