import { Button, List, Navigation, NavigationStack, Section, Text, TextField, useState } from "scripting"
import type { SavedTemplate } from "../store"
import { CUSTOM_TEMPLATE_PLACEHOLDERS, DEFAULT_CUSTOM_TEMPLATE } from "../apps"

export interface TemplateEditorResult {
  template: string
  templates: SavedTemplate[]
  /** 本次在弹层里保存过的那条 URL Scheme id；没保存过就没有 */
  savedId?: string
}

/**
 * 自定 URL Scheme 的取名弹层。只在参数说明页的内容还没有名字时打开，
 * 右上角「保存」= 写入方案 + `dismiss({template, templates, savedId})` 回传，主页关掉说明页直接用这条方案。
 * 已保存的方案从主页「目标 App」选单载入，删除在参数说明页右上角。
 */
export default function TemplateEditorView(props: { template: string; templates: SavedTemplate[] }) {
  const dismiss = Navigation.useDismiss()
  const [template, setTemplate] = useState(props.template || DEFAULT_CUSTOM_TEMPLATE)
  const [name, setName] = useState("")
  const [hint, setHint] = useState("")

  function saveTemplate() {
    const trimmedTemplate = template.trim()
    if (!trimmedTemplate) {
      setHint("内容是空的，先写点东西。")
      return
    }
    const templateName = name.trim() || `URL Scheme ${props.templates.length + 1}`
    const existing = props.templates.find(item => item.name === templateName)
    // 同名覆盖时沿用旧 id，别凭空造第二条
    const id = existing ? existing.id : `t${Date.now()}`
    const next: SavedTemplate[] = existing
      ? props.templates.map(item => (item.name === templateName ? { ...item, template: trimmedTemplate } : item))
      : [...props.templates, { id, name: templateName, template: trimmedTemplate }]
    dismiss({ template: trimmedTemplate, templates: next, savedId: id })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="保存 URL Scheme"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
          confirmationAction: <Button title="保存" action={saveTemplate} />,
        }}
      >
        <Section
          header={<Text>内容</Text>}
          footer={<Text>{`占位符：${CUSTOM_TEMPLATE_PLACEHOLDERS.join(" ")}（值会自动 URL 编码）`}</Text>}
        >
          <TextField
            title=""
            value={template}
            onChanged={setTemplate}
            axis="vertical"
            lineLimit={{ min: 4, max: 12 }}
          />
        </Section>

        <Section
          header={<Text>取名保存</Text>}
          footer={<Text>{`名字留空会自动取名；同名会覆盖。\n${hint}`.trim()}</Text>}
        >
          <TextField title="名称" value={name} onChanged={setName} />
        </Section>
      </List>
    </NavigationStack>
  )
}
