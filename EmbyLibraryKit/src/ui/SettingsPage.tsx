import { Button, HStack, List, Navigation, NavigationStack, Script, Section, Spacer, Text, Toggle, useState } from "scripting"
import { APP_PRESETS } from "../apps"
import type { SavedIconLibrary, SavedTemplate, Settings } from "../store"
import type { LibraryGroup, LibraryServer } from "../library"
import HelpView from "./HelpView"
import IconLibraryView from "./IconLibraryView"
import ParamDocView from "./ParamDocView"
import { setButtonEffects } from "./PillButton"
import TemplateListView from "./TemplateListView"

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function InfoRow(props: { label: string; value: string; action?: () => void }) {
  return (
    <HStack
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      {...(props.action ? { contentShape: { kind: "interaction", shape: "rect" } as const, onTapGesture: props.action } : {})}
    >
      <Text>{props.label}</Text>
      <Spacer />
      <Text foregroundStyle="secondaryLabel" lineLimit={1} truncationMode="middle">
        {props.value}
      </Text>
    </HStack>
  )
}

function ParamDocList() {
  const dismiss = Navigation.useDismiss()
  const [appId, setAppId] = useState("")
  const picked = APP_PRESETS.find(item => item.id === appId)
  if (picked) {
    return (
      <NavigationStack>
        <ParamDocView preset={picked} onBack={() => setAppId("")} />
      </NavigationStack>
    )
  }
  return (
    <NavigationStack>
      <List
        navigationTitle="参数说明"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          confirmationAction: <Button title="完成" action={dismiss} />,
        }}
      >
        {APP_PRESETS.filter(item => item.id !== "custom").map(item => (
          <InfoRow key={item.id} label={item.name} value="查看 ›" action={() => setAppId(item.id)} />
        ))}
      </List>
    </NavigationStack>
  )
}

export default function SettingsPage(props: {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => Settings
  servers: LibraryServer[]
  groups: LibraryGroup[]
  templates: SavedTemplate[]
  writeTemplates: (list: SavedTemplate[]) => boolean
  iconLibraries: SavedIconLibrary[]
  writeIconLibraries: (list: SavedIconLibrary[]) => boolean
}) {
  const dismiss = Navigation.useDismiss()
  const settings = props.settings
  const [message, setMessage] = useState("")

  function openTemplates() {
    Navigation.present({
      element: (
        <TemplateListView
          templates={props.templates}
          writeTemplates={props.writeTemplates}
          settings={props.settings}
          updateSettings={props.updateSettings}
        />
      ),
      modalPresentationStyle: "pageSheet",
    }).catch(error => setMessage(`打开自定 URL Scheme 失败 ${errorText(error)}`))
  }

  function openIconLibraries() {
    Navigation.present({
      element: <IconLibraryView libraries={props.iconLibraries} writeLibraries={props.writeIconLibraries} />,
      modalPresentationStyle: "pageSheet",
    }).catch(error => setMessage(`打开图标库失败 ${errorText(error)}`))
  }

  function openHelp() {
    Navigation.present({ element: <HelpView />, modalPresentationStyle: "pageSheet" }).catch(error => {
      console.log("打开使用说明失败", error)
      setMessage("无法打开使用说明")
    })
  }

  function openParamDocs() {
    Navigation.present({ element: <ParamDocList />, modalPresentationStyle: "pageSheet" }).catch(error => {
      console.log("打开参数说明失败", error)
      setMessage("无法打开参数说明")
    })
  }

  let version = ""
  try {
    version = Script.metadata.version || ""
  } catch (error) {
    console.log("读版本失败", error)
  }

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: <Button title="" systemImage="xmark" action={dismiss} />,
      }}
    >
      <Section header={<Text>提示</Text>}>
        <Toggle title="跳过已导入过的链接" value={settings.skipDone} onChanged={value => props.updateSettings({ skipDone: value })} />
        <Toggle title="结束后发送通知" value={settings.notify} onChanged={value => props.updateSettings({ notify: value })} />
        <Toggle
          title="按钮动效与震动"
          value={settings.buttonFX}
          onChanged={value => {
            setButtonEffects(value)
            props.updateSettings({ buttonFX: value })
          }}
        />
        {message ? (
          <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
            {message}
          </Text>
        ) : null}
      </Section>

      <Section header={<Text>数据</Text>}>
        <InfoRow label="媒体库" value={`${props.servers.length} 台 · ${props.groups.length} 组`} />
        <InfoRow label="自定 URL Scheme" value={`${props.templates.length} 条 ›`} action={openTemplates} />
        <InfoRow label="图标库" value={`${props.iconLibraries.length} 个 ›`} action={openIconLibraries} />
      </Section>

      <Section header={<Text>说明</Text>}>
        <InfoRow label="使用说明" value="查看 ›" action={openHelp} />
        <InfoRow label="参数说明" value="查看 ›" action={openParamDocs} />
        {version ? <InfoRow label="当前版本" value={version} /> : null}
      </Section>
    </List>
  )
}
