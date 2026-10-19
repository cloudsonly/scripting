import type { SubscriptionServer } from "./subscription"
import { splitAddress } from "./subscription"

export type AppId = "rex" | "forward" | "senplayer" | "vidora" | "eplayerx" | "custom"
export type ParamStyle = "rex" | "senplayer" | "vidora" | "eplayerx"
export type LineStyle = "rex" | "senplayer" | "vidora" | "eplayerx" | "none"

export interface ParamDocRow {
  name: string
  required: boolean
  desc: string
  group?: string
}

export interface ParamDoc {
  sample: string
  rows: ParamDocRow[]
  note?: string
}

export interface AppPreset {
  id: AppId
  name: string
  scheme: string
  host: string
  paramStyle: ParamStyle
  lineStyle: LineStyle
  doc: ParamDoc
}

export const CUSTOM_TEMPLATE_PLACEHOLDERS = [
  "{appScheme}",
  "{appPath}",
  "{type}",
  "{protocol}",
  "{host}",
  "{port}",
  "{path}",
  "{address}",
  "{username}",
  "{password}",
  "{title}",
  "{remark}",
  "{lines}",
]

export const DEFAULT_CUSTOM_TEMPLATE =
  "{appScheme}://{appPath}?type={type}&scheme={protocol}&host={host}&port={port}&username={username}&password={password}&title={title}&{lines}"

const REX_ROWS: ParamDocRow[] = [
  { name: "type", required: true, desc: "媒体服务器类型：emby / jellyfin / plex" },
  { name: "scheme", required: true, desc: "服务器协议：https / http" },
  { name: "host", required: true, desc: "服务器域名或 IP，例如 emby.example.com" },
  { name: "port", required: false, desc: "服务器端口，如 443 / 8096" },
  {
    name: "server_path",
    required: false,
    desc: "服务器路径（如 /npo）。官方参数表里没有这一项，实测地址带路径时写入才生效，所以只在有路径时才写",
  },
  { name: "username", required: false, desc: "登录用户名" },
  { name: "password", required: false, desc: "登录密码" },
  { name: "title", required: false, desc: "主线路名称，即在 App 里显示的名字" },
  { name: "lineN", required: false, desc: "第 N 条备用线路的完整地址，N 从 1 开始，例如 line1" },
  { name: "lineNtitle", required: false, desc: "第 N 条备用线路的名称，例如 line1title" },
]

export const APP_PRESETS: AppPreset[] = [
  {
    id: "rex",
    name: "Rex",
    scheme: "rex",
    host: "import",
    paramStyle: "rex",
    lineStyle: "rex",
    doc: {
      sample:
        "rex://import?type=emby&scheme=https&host=emby.example.com&port=443&username=test&password=123456&title=%F0%9F%8C%95My%20Rex&line1=https%3A%2F%2Fline1.example.com%3A443&line1title=%E5%A4%87%E7%94%A81",
      rows: REX_ROWS,
      note: "参数名、顺序与官方示例一致；备用线路可续多组 line2 / line2title …。地址带路径时会额外写 server_path（官方表外，实测有效）。",
    },
  },
  {
    id: "forward",
    name: "Forward",
    scheme: "forward",
    host: "import",
    paramStyle: "rex",
    lineStyle: "rex",
    doc: {
      sample:
        "forward://import?type=emby&scheme=https&host=emby.example.com&port=443&username=test&password=123456&title=%F0%9F%8C%95My%20Forward&line1=https%3A%2F%2Fline1.example.com%3A443&line1title=%E5%A4%87%E7%94%A81",
      rows: REX_ROWS,
      note: "与 Rex 参数完全相同（同一份官方参数表），只是 scheme 换成 forward。",
    },
  },
  {
    id: "senplayer",
    name: "SenPlayer",
    scheme: "senplayer",
    host: "importserver",
    paramStyle: "senplayer",
    lineStyle: "senplayer",
    doc: {
      sample:
        "senplayer://importserver?type=emby&name=My%20SenPlayer&note=%E5%A4%87%E6%B3%A8&address=https%3A%2F%2Femby.example.com%3A443&username=test&password=123456&address1name=%E5%A4%87%E7%94%A81&address1=https%3A%2F%2Fline1.example.com%3A443",
      rows: [
        {
          name: "type",
          required: true,
          desc: "媒体服务器类型，官方要求小写：emby / jellyfin / feiniu / webdav / smb / ftp",
        },
        { name: "name", required: false, desc: "服务器名称，即在 App 里显示的名字" },
        { name: "note", required: false, desc: "服务器备注" },
        {
          name: "address",
          required: true,
          desc: "主服务器完整地址，必须含协议与主机名，可带端口和路径，例如 https://emby.example.com:443",
        },
        { name: "username", required: false, desc: "登录用户名" },
        { name: "password", required: false, desc: "登录密码" },
        { name: "icon", required: false, desc: "服务器图标地址（图片 URL）。官方参数，我们从订阅里取不到，所以不会自动写入" },
        { name: "addressNname", required: false, desc: "第 N 条备用线路的名称，N 从 1 开始，例如 address1name" },
        { name: "addressN", required: false, desc: "第 N 条备用线路的完整地址，例如 address1" },
      ],
      note: "按官方文档：备用线路是 address1name / address1、address2name / address2 …，且只有 emby / jellyfin / feiniu 支持备用线路；需要 SenPlayer 5.7.0 以上。",
    },
  },
  {
    id: "vidora",
    name: "Vidora",
    scheme: "vidora",
    host: "emby/import",
    paramStyle: "vidora",
    lineStyle: "vidora",
    doc: {
      sample:
        "vidora://emby/import?server_url=https%3A%2F%2Femby.example.com%3A8443&server_path=%2Fxxxx&username=test&password=123456&name=My%20Vidora&backup=%E7%9B%B4%E8%BF%9E%7Chttps%3A%2F%2Fline1.example.com%3A8443&backup=CF%20%E7%BA%BF%E8%B7%AF%7Chttps%3A%2F%2Fline2.example.com",
      rows: [
        { name: "server_url", required: true, desc: "主服务器地址，必须为完整 http/https 地址" },
        { name: "server_path", required: false, desc: "服务器路径，例如 /xxxx（会自动与 server_url 拼接）" },
        { name: "username", required: true, desc: "Emby 用户名" },
        { name: "password", required: false, desc: "Emby 密码" },
        { name: "name", required: false, desc: "服务器显示名称" },
        { name: "backup", required: false, desc: "备用地址，格式「线路名|完整地址」，可重复最多 60 条" },
      ],
      note: "Vidora 没有公开参数表，这里的格式按真实样例逐字节校验；多条备用线路就重复多组 backup=线路名%7C地址（| 编码为 %7C），超出 60 条的部分不写入。",
    },
  },
  {
    id: "eplayerx",
    name: "EplayerX",
    scheme: "eplayerx",
    host: "add-or-update",
    paramStyle: "eplayerx",
    lineStyle: "eplayerx",
    doc: {
      sample:
        "eplayerx://add-or-update?type=emby&name=My%20EplayerX&remark=%E5%A4%87%E6%B3%A8&href=https%3A%2F%2Femby.example.com%3A443&username=test&password=123456&backupHref=https://line1.example.com:443;%E5%A4%87%E7%94%A81,http://line2.example.com:8096;%E5%A4%87%E7%94%A82",
      rows: [
        { name: "type", required: true, desc: "媒体服务器类型：emby / jellyfin / plex" },
        { name: "name", required: false, desc: "服务器名称，即在 App 里显示的名字" },
        { name: "remark", required: false, desc: "服务器备注" },
        { name: "href", required: true, desc: "主服务器完整地址（含协议与端口），例如 https://emby.example.com:443" },
        { name: "username", required: false, desc: "登录用户名" },
        { name: "password", required: false, desc: "登录密码" },
        {
          name: "backupHref",
          required: false,
          desc: "备用线路：只有一个 backupHref，多条用「,」隔开，每条是「完整地址;线路名」",
        },
      ],
      note:
        "按官方参数表：type、href 必选，其余可选。备用线路全部写在同一个 backupHref 里，条与条用「,」分开、地址与线路名用「;」分开；这两个分隔符按官方示例保持原样不编码（编码成 %2C %3B 则无法识别），只有线路名会编码。注意与 Vidora 相反，这里是「地址;名称」。我们生成自定义 scheme `eplayerx://add-or-update`；官方示例那种 `https://eplayerx.com/add-or-update` 通用链接参数完全相同；如需该形态，请在「自定 URL Scheme」中自行编写。",
    },
  },
  {
    id: "custom",
    name: "自定URL Scheme",
    scheme: "rex",
    host: "import",
    paramStyle: "rex",
    lineStyle: "rex",
    doc: {
      sample: DEFAULT_CUSTOM_TEMPLATE,
      rows: [
        { name: "{appScheme}", required: false, desc: "当前预设的 scheme，如 rex / senplayer / eplayerx", group: "链接结构" },
        { name: "{appPath}", required: false, desc: "当前预设 scheme 后面那一段，如 import", group: "链接结构" },
        { name: "{type}", required: false, desc: "媒体服务器类型：emby / jellyfin / plex", group: "服务器" },
        { name: "{protocol}", required: false, desc: "服务器协议 https / http", group: "服务器" },
        { name: "{host}", required: false, desc: "主机名或 IP，不含协议与端口", group: "服务器" },
        { name: "{port}", required: false, desc: "端口，如 443；地址里没有端口时为空", group: "服务器" },
        { name: "{path}", required: false, desc: "服务器路径（如 /npo），地址不带路径时为空", group: "服务器" },
        { name: "{address}", required: false, desc: "完整地址（协议 + 主机 + 端口 + 路径），SenPlayer 的 address、EplayerX 的 href 用它", group: "服务器" },
        { name: "{username}", required: false, desc: "登录用户名", group: "账号" },
        { name: "{password}", required: false, desc: "登录密码", group: "账号" },
        { name: "{title}", required: false, desc: "显示名称，对应各家的 title / name", group: "账号" },
        {
          name: "{remark}",
          required: false,
          desc: "备注（链接自带的 remark，或在参数编辑页手动填；开通通知的安全密码/到期不会写进链接）",
          group: "账号",
        },
        { name: "{lines}", required: false, desc: "备用线路片段，按当前线路风格展开，不含开头的 &", group: "线路" },
      ],
      note: "默认骨架按 Rex / Forward 的官方参数顺序排列，换别的 App 时改这里即可；占位符的值都会自动 URL 编码。",
    },
  },
]

export function appPreset(id: AppId): AppPreset {
  return APP_PRESETS.find(preset => preset.id === id) ?? APP_PRESETS[0]
}

export function isAppId(value: unknown): value is AppId {
  return typeof value === "string" && APP_PRESETS.some(preset => preset.id === value)
}

function encode(value: string): string {
  return encodeURIComponent(value)
}

function pairsToQuery(pairs: Array<[string, string]>): string {
  return pairs.map(([key, value]) => `${key}=${encode(value)}`).join("&")
}

export const VIDORA_MAX_BACKUP = 60

export function linesSegment(server: SubscriptionServer, lineStyle: LineStyle): string {
  if (lineStyle === "none") return ""
  const pairs: Array<[string, string]> = []
  if (lineStyle === "rex") {
    server.lines.forEach((line, index) => {
      const n = index + 1
      pairs.push([`line${n}`, line.address])
      if (line.name) pairs.push([`line${n}title`, line.name])
    })
  } else if (lineStyle === "senplayer") {
    server.lines.forEach((line, index) => {
      const n = index + 1
      if (line.name) pairs.push([`address${n}name`, line.name])
      pairs.push([`address${n}`, line.address])
    })
  } else if (lineStyle === "vidora") {
    for (const line of server.lines.slice(0, VIDORA_MAX_BACKUP)) {
      pairs.push(["backup", `${line.name}|${line.address}`])
    }
  } else if (lineStyle === "eplayerx") {
    const groups = server.lines.map(line =>
      line.name ? `${line.address};${encode(line.name)}` : line.address
    )
    return groups.length > 0 ? `backupHref=${groups.join(",")}` : ""
  }
  return pairsToQuery(pairs)
}

export function buildURL(server: SubscriptionServer, preset: AppPreset, customTemplate?: string): string {
  const split = splitAddress(server.address)
  const type = (server.type || "emby").toLowerCase()

  if (preset.id === "custom") {
    return renderCustomTemplate(customTemplate || DEFAULT_CUSTOM_TEMPLATE, server, preset)
  }

  const name = server.name
  const query: Array<[string, string]> = []

  if (preset.paramStyle === "rex") {
    query.push(["type", type])
    if (split.scheme) query.push(["scheme", split.scheme])
    if (split.host) query.push(["host", split.host])
    if (split.port) query.push(["port", split.port])
    if (split.path) query.push(["server_path", split.path])
    if (server.account) query.push(["username", server.account])
    if (server.password) query.push(["password", server.password])
    if (name) query.push(["title", name])
  } else if (preset.paramStyle === "senplayer") {
    query.push(["type", type])
    if (name) query.push(["name", name])
    if (server.remark) query.push(["note", server.remark])
    query.push(["address", server.address])
    if (server.account) query.push(["username", server.account])
    if (server.password) query.push(["password", server.password])
  } else if (preset.paramStyle === "eplayerx") {
    query.push(["type", type])
    if (name) query.push(["name", name])
    if (server.remark) query.push(["remark", server.remark])
    query.push(["href", server.address])
    if (server.account) query.push(["username", server.account])
    if (server.password) query.push(["password", server.password])
  } else {
    const base = `${split.scheme ? split.scheme + "://" : ""}${split.host}${split.port ? ":" + split.port : ""}`
    query.push(["server_url", base])
    if (split.path) query.push(["server_path", split.path])
    query.push(["username", server.account])
    query.push(["password", server.password])
    if (name) query.push(["name", name])
  }

  const linesQuery = linesSegment(server, preset.lineStyle)
  const queryString = pairsToQuery(query)
  const prefix = `${preset.scheme}://${preset.host}`
  return `${prefix}?${queryString}${linesQuery ? "&" + linesQuery : ""}`
}

function renderCustomTemplate(template: string, server: SubscriptionServer, preset: AppPreset): string {
  const split = splitAddress(server.address)
  const values: Record<string, string> = {
    type: encode((server.type || "emby").toLowerCase()),
    protocol: encode(split.scheme),
    host: encode(split.host),
    port: encode(split.port),
    path: encode(split.path),
    title: encode(server.name),
    username: encode(server.account),
    password: encode(server.password),
    address: encode(server.address),
    remark: encode(server.remark ?? ""),
    lines: linesSegment(server, preset.lineStyle),
    appScheme: preset.scheme,
    appPath: preset.host,
  }
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole)).replace(/&$/, "")
}

export function appNameForRaw(raw: string, fallback: string): string {
  const matched = APP_PRESETS.find(item => raw.toLowerCase().startsWith(`${item.scheme.toLowerCase()}://`))
  return matched ? matched.name : fallback
}
