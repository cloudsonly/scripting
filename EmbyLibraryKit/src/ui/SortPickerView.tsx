import { Button, HStack, Image, List, Navigation, NavigationStack, Section, Spacer, Text, useState } from "scripting"
import type { SortKey } from "../library"
import { SORT_KEYS, SORT_LABELS } from "../library"
import { ACCENT_TEXT } from "./tokens"

const DIRECTIONS: Array<{ value: boolean; label: string }> = [
  { value: false, label: "递增（A→Z、旧→新）" },
  { value: true, label: "递减（Z→A、新→旧）" },
]

function ChoiceRow(props: { label: string; on: boolean; action: () => void }) {
  return (
    <HStack
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      contentShape={{ kind: "interaction", shape: "rect" }}
      onTapGesture={props.action}
    >
      <Text>{props.label}</Text>
      <Spacer />
      {props.on ? <Image systemName="checkmark" font={15} foregroundStyle={ACCENT_TEXT} /> : null}
    </HStack>
  )
}

export default function SortPickerView(props: {
  sort: SortKey
  descending: boolean
  onPick: (key: SortKey, descending: boolean) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [key, setKey] = useState<SortKey>(props.sort)
  const [descending, setDescending] = useState(props.descending)

  function pickKey(next: SortKey) {
    setKey(next)
    props.onPick(next, descending)
  }

  function pickDirection(next: boolean) {
    setDescending(next)
    props.onPick(key, next)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="列表排序"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          confirmationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        <Section header={<Text>排序依据</Text>}>
          {SORT_KEYS.map(item => (
            <ChoiceRow key={item} label={SORT_LABELS[item]} on={item === key} action={() => pickKey(item)} />
          ))}
        </Section>
        <Section header={<Text>顺序</Text>}>
          {DIRECTIONS.map(item => (
            <ChoiceRow
              key={String(item.value)}
              label={item.label}
              on={item.value === descending}
              action={() => pickDirection(item.value)}
            />
          ))}
        </Section>
        <Section header={<Text>说明</Text>}>
          <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
            选择即刻生效，媒体库与搜索两个标签共用同一份排序。同一排名的服务器仍按加入先后排列；分组折叠与筛选结果都按此顺序显示。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}
