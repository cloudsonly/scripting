import { Button, HStack, List, Navigation, NavigationStack, Section, Text, TextField, useState } from "scripting"
import type { SchemeEntry } from "../parse"
import type { SubscriptionLine, SubscriptionServer } from "../subscription"
import { serverFromEntry, splitAddress } from "../subscription"

/** 一行一个字段：标签固定显示在左，输入框右对齐 */
function Field(props: { label: string; value: string; placeholder?: string; onChanged: (value: string) => void }) {
  return (
    <HStack>
      <Text>{props.label}</Text>
      <TextField
        title=""
        prompt={props.placeholder}
        value={props.value}
        onChanged={props.onChanged}
        frame={{ maxWidth: "infinity" }}
        multilineTextAlignment="trailing"
      />
    </HStack>
  )
}

function linesToText(lines: SubscriptionLine[]): string {
  return lines.map(line => (line.name ? `${line.name}|${line.address}` : line.address)).join("\n")
}

function textToLines(text: string): SubscriptionLine[] {
  const result: SubscriptionLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const separator = line.indexOf("|")
    if (separator >= 0) result.push({ name: line.slice(0, separator).trim(), address: line.slice(separator + 1).trim() })
    else result.push({ name: "", address: line })
  }
  return result
}

/**
 * 编辑一条待导入条目的参数。
 *
 * 作为**弹层**（pageSheet）呈现——主页列表不会被卸载，所以关闭后仍停在原来那一行；
 * 保存时用 `dismiss(server)` 把新参数回传给主页。
 */
export default function EntryEditorView(props: {
  entry: SchemeEntry
  appName: string
  buildPreview: (server: SubscriptionServer) => string
}) {
  const dismiss = Navigation.useDismiss()
  const initial = serverFromEntry(props.entry)
  if (!props.entry.host) initial.address = ""
  const split = splitAddress(initial.address)

  const [name, setName] = useState(initial.name)
  const [type, setType] = useState(initial.type || "emby")
  const [protocol, setProtocol] = useState(split.scheme || "https")
  const [host, setHost] = useState(split.host)
  const [port, setPort] = useState(split.port)
  const [path, setPath] = useState(split.path)
  const [account, setAccount] = useState(initial.account)
  const [password, setPassword] = useState(initial.password)
  const [linesText, setLinesText] = useState(linesToText(initial.lines))
  const [remark, setRemark] = useState(initial.remark ?? "")

  const trimmedHost = host.trim()
  const server: SubscriptionServer = {
    name: name.trim(),
    type: (type.trim() || "emby").toLowerCase(),
    address: trimmedHost
      ? `${protocol.trim() || "https"}://${trimmedHost}${port.trim() ? ":" + port.trim() : ""}${path.trim()}`
      : "",
    account: account.trim(),
    password,
    remark: remark.trim() || undefined,
    lines: textToLines(linesText),
  }
  const preview = server.address ? props.buildPreview(server) : "（缺少主机，无法生成链接）"

  return (
    <NavigationStack>
      <List
        navigationTitle="编辑参数"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
          confirmationAction: <Button title="保存" action={() => dismiss(server)} />,
        }}
      >
      <Section header={<Text>服务器</Text>} footer={<Text>所有值都会自动 URL 编码后写入导入链接。</Text>}>
        <Field label="名称" value={name} placeholder="显示名称" onChanged={setName} />
        <Field label="类型" value={type} placeholder="emby / jellyfin" onChanged={setType} />
        <Field label="协议" value={protocol} placeholder="https" onChanged={setProtocol} />
        <Field label="主机" value={host} placeholder="emby.example.com" onChanged={setHost} />
        <Field label="端口" value={port} placeholder="443" onChanged={setPort} />
        <Field label="路径" value={path} placeholder="/npo（可留空）" onChanged={setPath} />
        <Field label="用户名" value={account} placeholder="username" onChanged={setAccount} />
        <Field label="密码" value={password} placeholder="password" onChanged={setPassword} />
        <Field label="备注" value={remark} placeholder="remark（可留空）" onChanged={setRemark} />
      </Section>

      <Section header={<Text>备用线路</Text>} footer={<Text>每行一条：名称|地址（名称可省略，只写地址也行）</Text>}>
        <TextField
          title=""
          prompt="¹分流|https://a.example.org:443"
          value={linesText}
          onChanged={setLinesText}
          axis="vertical"
          lineLimit={{ min: 3, max: 10 }}
        />
      </Section>

      {props.entry.note ? (
        <Section header={<Text>备注</Text>} footer={<Text>来自开通通知的账号信息（安全密码 / 到期时间），仅作展示，不会写入导入链接；确实需要时可选中复制到上面的「备注」。</Text>}>
          <Text textSelection={true}>{props.entry.note}</Text>
        </Section>
      ) : null}

      <Section header={<Text>生成的导入链接</Text>}>
        <Text font="caption" monospaced={true} textSelection={true}>
          {preview}
        </Text>
      </Section>
      </List>
    </NavigationStack>
  )
}
