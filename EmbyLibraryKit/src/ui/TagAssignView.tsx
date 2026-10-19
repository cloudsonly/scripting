import { Button, HStack, List, Navigation, NavigationStack, Section, Text, TextField, useState } from "scripting"
import { normalizeTags } from "../library"
import { PillButton } from "./PillButton"
import { DANGER } from "./tokens"
import { TagGroup } from "./TagChip"

export interface TagAssignResult {
  tags: string[]
  add: boolean
}

export default function TagAssignView(props: { tags: string[]; count: number }) {
  const dismiss = Navigation.useDismiss()
  const [pool, setPool] = useState<string[]>(normalizeTags(props.tags))
  const [chosen, setChosen] = useState<string[]>([])
  const [draft, setDraft] = useState("")

  function toggle(tag: string) {
    setChosen(current => (current.indexOf(tag) >= 0 ? current.filter(item => item !== tag) : current.concat(tag)))
  }

  function addDraft() {
    const added = normalizeTags(draft)
    if (added.length === 0) return
    let changed = false
    const next = pool.slice()
    for (const tag of added) {
      if (next.some(item => item.toLowerCase() === tag.toLowerCase())) continue
      next.push(tag)
      changed = true
    }
    if (changed) setPool(next)
    setChosen(current => current.concat(added.filter(tag => !current.some(item => item.toLowerCase() === tag.toLowerCase()))))
    setDraft("")
  }

  function apply(add: boolean) {
    if (chosen.length === 0) return
    dismiss({ tags: chosen, add })
  }

  const items = pool.map(tag => ({ label: tag, on: chosen.some(item => item.toLowerCase() === tag.toLowerCase()), action: () => toggle(tag) }))

  return (
    <NavigationStack>
      <List
        navigationTitle={`分配标签（${props.count} 台）`}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
        }}
      >
        <Section header={<Text>选择标签</Text>}>
          <TagGroup items={items} empty="还没有任何标签，可在下方新建一个。" />
          <Text font="caption" foregroundStyle="secondaryLabel">
            {`已选 ${chosen.length} 个标签`}
          </Text>
        </Section>

        <Section header={<Text>新建标签</Text>}>
          <HStack spacing={8}>
            <TextField
              title="新标签"
              prompt="标签名（空格或逗号可一次输入多个）"
              value={draft}
              onChanged={setDraft}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            />
            <PillButton title="添加" disabled={draft.trim().length === 0} action={addDraft} />
          </HStack>
        </Section>

        <Section header={<Text>应用到所选服务器</Text>}>
          <PillButton title={`添加这 ${chosen.length} 个标签`} disabled={chosen.length === 0} action={() => apply(true)} />
          <PillButton
            title={`移除这 ${chosen.length} 个标签`}
            color={DANGER}
            disabled={chosen.length === 0}
            action={() => apply(false)}
          />
          <Text font="caption" foregroundStyle="secondaryLabel">
            添加只会并入、不会删掉这些服务器原有的标签；移除只去掉你上面选中的那几个。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}
