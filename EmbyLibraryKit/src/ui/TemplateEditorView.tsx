import { Button, List, Navigation, NavigationStack, Section, Text, TextField, useState } from "scripting"
import type { SavedTemplate } from "../store"
import { CUSTOM_TEMPLATE_PLACEHOLDERS, DEFAULT_CUSTOM_TEMPLATE } from "../apps"

export interface TemplateEditorResult {
  template: string
  templates: SavedTemplate[]
  savedId?: string
}

export default function TemplateEditorView(props: { template: string; templates: SavedTemplate[] }) {
  const dismiss = Navigation.useDismiss()
  const [template, setTemplate] = useState(props.template || DEFAULT_CUSTOM_TEMPLATE)
  const [name, setName] = useState("")
  const [hint, setHint] = useState("")

  function saveTemplate() {
    const trimmedTemplate = template.trim()
    if (!trimmedTemplate) {
      setHint("内容为空，请先输入正文。")
      return
    }
    const templateName = name.trim() || `URL Scheme ${props.templates.length + 1}`
    const existing = props.templates.find(item => item.name === templateName)
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
