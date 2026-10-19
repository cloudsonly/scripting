import { Button, HStack, List, Navigation, NavigationStack, Section, Spacer, Text, useState } from "scripting"
import { DEFAULT_CUSTOM_TEMPLATE, appPreset } from "../apps"
import type { SavedTemplate, Settings } from "../store"
import ParamDocView from "./ParamDocView"
import { PillButton } from "./PillButton"
import type { TemplateEditorResult } from "./TemplateEditorView"
import TemplateEditorView from "./TemplateEditorView"

type DocTarget = { kind: "template"; templateId: string } | { kind: "new"; draft: string }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function TemplateListView(props: {
  templates: SavedTemplate[]
  writeTemplates: (list: SavedTemplate[]) => boolean
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => Settings
}) {
  const dismiss = Navigation.useDismiss()
  const [list, setList] = useState<SavedTemplate[]>(props.templates)
  const [doc, setDoc] = useState<DocTarget | null>(null)
  const [status, setStatus] = useState("")

  function persist(next: SavedTemplate[], note: string) {
    setList(next)
    setStatus(props.writeTemplates(next) ? note : `${note} 未写入本机存储`)
  }

  function nameNewTemplate(content: string) {
    Navigation.present<TemplateEditorResult>({
      element: <TemplateEditorView template={content} templates={list} />,
      modalPresentationStyle: "pageSheet",
    })
      .then(result => {
        if (!result?.savedId) return
        const name = result.templates.find(item => item.id === result.savedId)?.name ?? "URL Scheme"
        persist(result.templates, `已新建 URL Scheme ${name}`)
        setDoc(null)
      })
      .catch(error => setStatus(`保存失败 ${errorText(error)}`))
  }

  function overwriteTemplate(id: string, content: string) {
    const saved = list.find(item => item.id === id)
    persist(
      list.map(item => (item.id === id ? { ...item, template: content } : item)),
      `已保存到 ${saved ? saved.name : id}`
    )
  }

  function renameTemplate(template: SavedTemplate) {
    Dialog.prompt({ title: "方案改名", defaultValue: template.name, confirmLabel: "保存", cancelLabel: "取消" })
      .then(name => {
        const trimmed = (name || "").trim()
        if (!trimmed || trimmed === template.name) return
        persist(
          list.map(item => (item.id === template.id ? { ...item, name: trimmed } : item)),
          `方案名已改为 ${trimmed}`
        )
      })
      .catch(error => setStatus(`改名失败 ${errorText(error)}`))
  }

  function deleteTemplate(template: SavedTemplate) {
    Dialog.confirm({
      title: `删除 URL Scheme「${template.name}」？`,
      message: "该方案及其正文将被删除。",
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
      .then(confirmed => {
        if (!confirmed) return
        persist(
          list.filter(item => item.id !== template.id),
          `已删除 URL Scheme ${template.name}`
        )
        if (props.settings.appId === "custom" && props.settings.activeTemplateId === template.id) {
          props.updateSettings({ appId: "rex", activeTemplateId: undefined, customTemplate: "" })
        }
        setDoc(null)
      })
      .catch(error => setStatus(`删除失败 ${errorText(error)}`))
  }

  function removeTemplate(template: SavedTemplate) {
    persist(
      list.filter(item => item.id !== template.id),
      `已删除 URL Scheme ${template.name}`
    )
    if (props.settings.appId === "custom" && props.settings.activeTemplateId === template.id) {
      props.updateSettings({ appId: "rex", activeTemplateId: undefined, customTemplate: "" })
    }
  }

  if (doc && doc.kind === "new") {
    return (
      <NavigationStack>
        <ParamDocView
          preset={appPreset("custom")}
          initialSample={doc.draft}
          onBack={() => setDoc(null)}
          onEditTemplate={(current: string) => nameNewTemplate(current)}
          onCloseTemplate={(current: string, dirty: boolean) => {
            if (!dirty) {
              setDoc(null)
              return
            }
            Dialog.actionSheet({
              title: "该方案尚未命名",
              message: "保存需先命名；选择丢弃则不写入任何内容。",
              actions: [{ label: "保存并取名" }, { label: "丢弃改动", destructive: true }],
              cancelButton: true,
            })
              .then(choice => {
                if (choice === 0) nameNewTemplate(current)
                else if (choice === 1) setDoc(null)
              })
              .catch(error => setStatus(`保存失败 ${errorText(error)}`))
          }}
        />
      </NavigationStack>
    )
  }

  const editing = doc && doc.kind === "template" ? list.find(item => item.id === doc.templateId) : undefined
  if (doc && doc.kind === "template" && editing) {
    return (
      <NavigationStack>
        <ParamDocView
          preset={appPreset("custom")}
          activeTemplateName={editing.name}
          initialSample={editing.template}
          onRenameTemplate={() => renameTemplate(editing)}
          onBack={() => setDoc(null)}
          onEditTemplate={(current: string) => overwriteTemplate(editing.id, current)}
          onDeleteTemplate={() => deleteTemplate(editing)}
          onCloseTemplate={(current: string, dirty: boolean) => {
            if (!dirty) {
              setDoc(null)
              return
            }
            Dialog.actionSheet({
              title: "存在未保存的改动",
              message: `保存会覆盖 URL Scheme「${editing.name}」。`,
              actions: [{ label: `保存到「${editing.name}」` }, { label: "丢弃改动", destructive: true }],
              cancelButton: true,
            })
              .then(choice => {
                if (choice === null) return
                if (choice === 0) overwriteTemplate(editing.id, current)
                setDoc(null)
              })
              .catch(error => setStatus(`保存失败 ${errorText(error)}`))
          }}
        />
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="自定 URL Scheme"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          confirmationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        <Section header={<Text>已保存</Text>} footer={<Text>点一条编辑正文 左滑删除。占位符 {`{host} {port} {username} {password} {lines}`}</Text>}>
          <PillButton title="新建 URL Scheme" action={() => setDoc({ kind: "new", draft: DEFAULT_CUSTOM_TEMPLATE })} />
          {list.length === 0 ? (
            <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
              尚无自定方案 新建时会带默认骨架
            </Text>
          ) : (
            list.map(template => (
              <SchemeRow
                key={template.id}
                title={template.name || "未命名"}
                detail={`${template.template.length} 字`}
                onOpen={() => setDoc({ kind: "template", templateId: template.id })}
                onRemove={() => removeTemplate(template)}
              />
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

function SchemeRow(props: { title: string; detail: string; onOpen: () => void; onRemove: () => void }) {
  return (
    <HStack
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [<Button key="delete" title="删除" role="destructive" action={props.onRemove} />],
      }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      contentShape={{ kind: "interaction", shape: "rect" }}
      onTapGesture={props.onOpen}
    >
      <Text bold={true} lineLimit={1}>
        {props.title}
      </Text>
      <Spacer />
      <Text font="caption" foregroundStyle="secondaryLabel">
        {`${props.detail} ›`}
      </Text>
    </HStack>
  )
}
