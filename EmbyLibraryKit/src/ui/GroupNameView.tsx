import { Button, List, Navigation, NavigationStack, Section, Text, TextField, useState } from "scripting"
import { DANGER_TEXT } from "./tokens"

export interface GroupNameResult {
  name: string
}

export default function GroupNameView(props: { title: string; value: string }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(props.value)
  const [error, setError] = useState("")

  function save() {
    const trimmed = name.trim()
    console.log("GroupNameView save:", JSON.stringify(name), "→", JSON.stringify(trimmed))
    if (!trimmed) {
      setError("分组名称不能为空。")
      return
    }
    dismiss({ name: trimmed })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={props.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
          confirmationAction: <Button title="保存" action={save} />,
        }}
      >
        <Section header={<Text>分组</Text>}>
          <TextField
            title="分组名称"
            prompt="例如：主力 / CF 分流"
            value={name}
            onChanged={value => {
              setError("")
              setName(value)
            }}
            frame={{ maxWidth: "infinity", alignment: "leading" }}
          />
          {error ? (
            <Text font="caption" foregroundStyle={DANGER_TEXT}>
              {error}
            </Text>
          ) : null}
        </Section>
      </List>
    </NavigationStack>
  )
}
