import { Button, Editor, Text, VStack, useEffect, useMemo } from "scripting"

/** 全屏文本编辑（用 Scripting 原生 Editor，键盘/滚动表现与代码编辑器一致） */
export default function TextEditorView(props: {
  text: string
  onParse: (text: string) => void
  onCancel: () => void
  title?: string
  confirmTitle?: string
  hint?: string
}) {
  const controller = useMemo(() => new EditorController({ content: props.text, ext: "txt", readOnly: false }), [])

  useEffect(() => {
    return () => {
      controller.dispose()
    }
  }, [controller])

  return (
    <VStack
      spacing={0}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      navigationTitle={props.title ?? "编辑文本"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="返回" action={props.onCancel} />,
        confirmationAction: <Button title={props.confirmTitle ?? "解析"} action={() => props.onParse(controller.content)} />,
      }}
    >
      <Editor controller={controller} scriptName="导入文本" />
      <Text font="caption" foregroundStyle="secondaryLabel" padding={{ horizontal: 16, vertical: 8 }}>
        {props.hint ?? "可直接粘贴导入链接 / 订阅 JSON / 开通通知；点右上角「解析」识别。"}
      </Text>
    </VStack>
  )
}
