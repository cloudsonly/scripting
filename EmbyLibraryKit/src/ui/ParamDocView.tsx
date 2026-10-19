import { Button, Editor, HStack, List, Section, Spacer, Text, VStack, useEffect, useMemo, useRef, useState } from "scripting"
import type { AppPreset, ParamDocRow } from "../apps"
import { PillButton } from "./PillButton"
import { ACCENT_TEXT, DANGER_TEXT, SUCCESS, SUCCESS_TEXT } from "./tokens"
import TextEditorView from "./TextEditorView"

function groupRows(rows: ParamDocRow[]): Array<{ title: string; rows: ParamDocRow[] }> {
  const groups: Array<{ title: string; rows: ParamDocRow[] }> = []
  for (const row of rows) {
    const title = row.group ?? ""
    const found = groups.find(item => item.title === title)
    if (found) found.rows.push(row)
    else groups.push({ title, rows: [row] })
  }
  return groups
}

function decodeSafe(text: string) {
  try {
    return decodeURIComponent(text)
  } catch (error) {
    return text
  }
}

function readableSample(raw: string) {
  const cut = raw.indexOf("?")
  if (cut < 0) return decodeSafe(raw)
  const params = raw
    .slice(cut + 1)
    .split("&")
    .map(item => decodeSafe(item))
  return [decodeSafe(raw.slice(0, cut)), ...params.map((item, index) => `   ${index === 0 ? "?" : "&"}${item}`)].join("\n")
}

type Status = { kind: "copy" | "type"; name: string }

export default function ParamDocView(props: {
  preset: AppPreset
  onBack: () => void
  onCloseTemplate?: (current: string, dirty: boolean) => void
  onEditTemplate?: (current: string) => void
  activeTemplateName?: string
  onDeleteTemplate?: () => void
  onRenameTemplate?: () => void
  initialSample?: string
}) {
  const { preset } = props
  const doc = preset.doc
  const editable = preset.id === "custom"
  const [status, setStatus] = useState<Status | null>(null)
  const [full, setFull] = useState(false)

  const editor = useMemo(
    () => new EditorController({ content: props.initialSample ?? doc.sample, ext: "txt", readOnly: false }),
    []
  )
  const baselineRef = useRef(editor.content)
  useEffect(() => {
    return () => {
      editor.dispose()
    }
  }, [editor])

  useEffect(() => {
    if (!editable || props.initialSample === undefined) return
    if (props.initialSample !== editor.content) editor.content = props.initialSample
    baselineRef.current = props.initialSample
  }, [props.initialSample])

  function back() {
    const dirty = editor.content.trim() !== baselineRef.current.trim()
    if (editable && props.onCloseTemplate) props.onCloseTemplate(editor.content, dirty)
    else props.onBack()
  }

  function show(next: Status) {
    setStatus(next)
    setTimeout(() => setStatus(null), 1500)
  }

  async function copy(name: string) {
    try {
      await Pasteboard.setString(name)
      show({ kind: "copy", name })
    } catch (error) {
      console.log("copy failed", error)
    }
  }

  function insert(name: string) {
    try {
      editor.replaceSelection(name)
      editor.scrollSelectionIntoView()
      show({ kind: "type", name })
    } catch (error) {
      console.log("insert failed", error)
      show({ kind: "type", name: "（请先点按示例区）" })
    }
  }

  if (full) {
    return (
      <TextEditorView
        text={editor.content}
        title="编辑 URL Scheme"
        confirmTitle="完成"
        hint="改完点右上角「完成」回到参数说明。这里就是当前自定 URL Scheme 的正文，要留下改动请回去点「保存」。"
        onParse={text => {
          editor.content = text
          setFull(false)
        }}
        onCancel={() => setFull(false)}
      />
    )
  }

  return (
    <List
      navigationTitle={`${preset.name} 参数说明`}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="返回" action={back} />,
        topBarTrailing: [
          ...(status
            ? [
                <Text key="status" font="caption" foregroundStyle={SUCCESS_TEXT}>
                  {`${status.kind === "copy" ? "已复制" : "已键入"} ${status.name}`}
                </Text>,
              ]
            : []),
          ...(props.onRenameTemplate
            ? [<Button key="rename" title="" systemImage="pencil" action={props.onRenameTemplate} />]
            : []),
          ...(props.onDeleteTemplate
            ? [<Button key="delete" title="" systemImage="trash" role="destructive" action={props.onDeleteTemplate} />]
            : []),
        ],
      }}
    >
      {editable ? (
        <Section
          header={
            <Text>
              {props.activeTemplateName ? `完整示例（URL Scheme「${props.activeTemplateName}」）` : "完整示例（未命名 Scheme）"}
            </Text>
          }
          footer={
            <Text>{`点参数行右侧「键入」把占位符插到光标处（有选区就替换选区）；点参数名 = 复制到剪贴板。\n${
              props.activeTemplateName
                ? `改完点「保存到「${props.activeTemplateName}」」直接覆盖；右上角垃圾桶删掉这条并回到主页。`
                : "这是一份新方案，点「保存」取个名字，保存后直接回主页用它。"
            }\n${doc.note ?? ""}`}</Text>
          }
        >
          <VStack spacing={0} frame={{ maxWidth: "infinity", height: 220 }}>
            <Editor controller={editor} />
          </VStack>
          <HStack spacing={10}>
            <PillButton title="全屏编辑" action={() => setFull(true)} />
            <PillButton
              title={props.activeTemplateName ? `保存到「${props.activeTemplateName}」` : "保存"}
              color={SUCCESS}
              action={() => props.onEditTemplate?.(editor.content)}
            />
          </HStack>
        </Section>
      ) : (
        <Section
          header={<Text>完整示例</Text>}
          footer={
            <Text>{`${doc.note ?? ""}${doc.note ? "\n" : ""}所有参数值都需要 URL 编码（空格→%20、@→%40、&→%26、|→%7C）；这里为方便阅读已还原编码。`}</Text>
          }
        >
          <Text font="caption" monospaced={true} textSelection={true} multilineTextAlignment="leading">
            {readableSample(doc.sample)}
          </Text>
        </Section>
      )}

      {groupRows(doc.rows).map(group => (
        <Section key={group.title || "params"} header={<Text>{group.title ? group.title : "参数"}</Text>}>
          {group.rows.map(row => (
            <VStack
              key={row.name}
              alignment="leading"
              spacing={2}
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <HStack
                  spacing={8}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                  contentShape={{ kind: "interaction", shape: "rect" }}
                  onTapGesture={() => {
                    if (editable) copy(row.name)
                  }}
                >
                  <Text bold={true} monospaced={true} foregroundStyle={ACCENT_TEXT}>
                    {row.name}
                  </Text>
                  <Text font="caption2" foregroundStyle={row.required ? DANGER_TEXT : "secondaryLabel"}>
                    {row.required ? "必填" : "可选"}
                  </Text>
                  <Spacer />
                </HStack>
                {editable ? (
                  <Text
                    font="caption2"
                    foregroundStyle={status?.kind === "type" && status.name === row.name ? SUCCESS_TEXT : ACCENT_TEXT}
                    contentShape={{ kind: "interaction", shape: "rect" }}
                    onTapGesture={() => insert(row.name)}
                  >
                    {status?.kind === "type" && status.name === row.name ? "已键入" : "键入"}
                  </Text>
                ) : null}
              </HStack>
              <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="leading">
                {row.desc}
              </Text>
            </VStack>
          ))}
        </Section>
      ))}
    </List>
  )
}
