import type { SubscriptionLine, SubscriptionServer } from "./subscription"

export interface NoticeResult {
  items: SubscriptionServer[]
}

const NOTICE_KEYWORDS = [
  "创建用户成功",
  "恢复成功",
  "用户名称",
  "用户密码",
  "安全密码",
  "安全码",
  "到期时间",
  "当前线路",
  "主线路",
  "登录账号",
  "网站账号",
  "线路",
  "用户名",
  "密码",
]

const ANY_SCHEME_RE = /([A-Za-z][A-Za-z0-9+.\-]*):\/\/(\S*)/g
const HTTP_SCHEMES = ["http", "https"]

function hasImportLink(text: string): boolean {
  for (const match of text.matchAll(ANY_SCHEME_RE)) {
    const scheme = (match[1] || "").toLowerCase()
    if (HTTP_SCHEMES.indexOf(scheme) >= 0) continue
    if ((match[2] || "").indexOf("?") >= 0) return true
  }
  return false
}

const HAS_URL_RE = /https?:\/\/\S+/i
const SUBSCRIBE_URL_RE = /(subscribe|token=|\/sub\/|\.ya?ml(?:\?|$))/i
const ROUTE_STOP_RE = /^\s*(?:[━─—–▬]+|[-*_]{4,})\s*$/
const LABEL_BRACKET_RE = /\[([^\]]{1,14})\]|【([^】]{1,14})】/

const FIELD_RE = /^[·•▎●▪‣*\s\u3000]*([^=|｜：:]+?)\s*(?:=|\||｜|：|:)\s*(.*)$/
const URL_RE = /https?:\/\/[^\s<>"'，。；;、）》】］]+/gi

const USERNAME_KEYS = [
  "用户名称",
  "emby账号",
  "emby用户名",
  "用户名",
  "登录账号",
  "登陆账号",
  "账号",
  "username",
  "user",
  "account",
  "网站账号",
]

function normalize(text: string): string {
  return (text || "").replace(/\r\n?/g, "\n")
}

function cleanURL(value: string): string {
  const head = value.trim().split(/\s+/)[0]
  return head
    .replace(/^<|>$/g, "")
    .replace(/[）)】］\]}>，。；;、]+$/g, "")
    .trim()
}

function cleanValue(value: string): string {
  return value
    .trim()
    .replace(/[（(]仅发送一次[）)]/g, "")
    .replace(/[，。；;】」》\]]+$/g, "")
    .trim()
}

function fieldKey(key: string): string {
  return key
    .replace(/^[^一-鿿A-Za-z0-9]+/, "")
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "")
    .replace(/[*_\s\u3000]+/g, "")
    .toLowerCase()
    .replace(/为$/, "")
}

function isUsernameKey(key: string): boolean {
  if (!key) return false
  if (/密码|安全|线路|地址|网址|url|path|到期/.test(key)) return false
  return /账号$|帐户$|用户名$|用户名称$|^username$|^user$|^account$/.test(key) || /emby.*账号/.test(key)
}

function isPasswordKey(key: string): boolean {
  if (!key) return false
  if (/安全|锁屏|二级|pin|pattern/.test(key)) return false
  return /密码$|^pass$|^passwd$|^pwd$|password|口令/.test(key)
}

function isPortKey(key: string): boolean {
  return /^端口(号)?$|^port$/.test(key)
}

function isRouteKey(key: string): boolean {
  return /线路|地址|直连|反代|backup|address|server_url|^url$/.test(key)
}

interface NoticeField {
  key: string
  rawKey: string
  value: string
}

function parseFields(text: string): NoticeField[] {
  const fields: NoticeField[] = []
  const lines = normalize(text).split("\n")
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue

    const match = FIELD_RE.exec(line)
    if (match) {
      const rawKey = match[1].trim()
      const key = fieldKey(rawKey)
      let value = cleanValue(match[2])
      let cursor = index
      if (!value && cursor + 1 < lines.length && /^https?:\/\//i.test((lines[cursor + 1] ?? "").trim())) {
        value = cleanURL(lines[cursor + 1])
        cursor++
      }
      if (!value) {
        const next = (lines[cursor + 1] ?? "").trim()
        if (next && !FIELD_RE.test(next) && !/^https?:\/\//i.test(next)) {
          value = cleanValue(next)
          cursor++
        }
      }
      if (key || /^https?:\/\//i.test(value)) fields.push({ key, rawKey, value })
      index = cursor
      continue
    }

    if (/^https?:\/\//i.test(line)) fields.push({ key: "", rawKey: "", value: cleanURL(line) })
  }
  return fields
}

function pick(fields: NoticeField[], predicate: (key: string) => boolean): string {
  return fields.find(field => field.key && predicate(field.key) && field.value)?.value ?? ""
}

function pickUsername(fields: NoticeField[], text: string): string {
  for (const wanted of USERNAME_KEYS) {
    const key = fieldKey(wanted)
    const found = fields.find(field => field.key === key && field.value)
    if (found) return found.value
  }
  const anyUsername = pick(fields, isUsernameKey)
  if (anyUsername) return anyUsername
  const patterns = [
    /您的账号\s*[:：]?\s*([^\s:：|｜，。！!]+?)\s*已(?:恢复|创建|开通|注册)/,
    /账号\s*[:：]?\s*([^\s:：|｜，。！!]+?)\s*已(?:恢复|创建|开通|注册)/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1]) return cleanValue(match[1])
  }
  return ""
}

interface NoticeRoute {
  name: string
  url: string
}

const BULLET_RE = /^[·•▎●▪‣\s　]+/

function keepLabelChars(value: string): string {
  let out = ""
  for (const ch of value) {
    const code = ch.codePointAt(0) || 0
    const isAscii = code >= 0x21 && code <= 0x7e
    const isCjk = code >= 0x4e00 && code <= 0x9fff
    if (isAscii || isCjk || code === 0x20) out += ch
  }
  return out.replace(/\s+/g, " ").trim()
}

function routeRegion(text: string): string {
  const kept: string[] = []
  let seenURL = false
  for (const line of text.split("\n")) {
    // 分隔线通常用来截掉尾部的客服/群组信息；但如果还没出现过地址，
    // 说明分隔线在地址上方（如「周年庆体验卡」通知），不能就此截断。
    if (seenURL && ROUTE_STOP_RE.test(line)) break
    if (!seenURL && HAS_URL_RE.test(line)) seenURL = true
    kept.push(line)
  }
  return kept.join("\n")
}

function labelBeforeURL(text: string, url: string): string {
  const at = text.indexOf(url)
  if (at <= 0) return ""
  const head = text.slice(0, at).replace(URL_RE, " ")
  const lines = head.split("\n")
  for (let index = lines.length - 1; index >= 0; index--) {
    const rawLine = lines[index].replace(/[|｜:=：\s]+$/g, "").replace(BULLET_RE, "").trim()
    if (!rawLine || /[|｜:=：]/.test(rawLine)) continue
    const bracket = LABEL_BRACKET_RE.exec(rawLine)
    const label = keepLabelChars(bracket ? bracket[1] || bracket[2] || "" : rawLine)
    if (!label || label.length > 20) continue
    if (!/[A-Za-z\u4e00-\u9fff]/.test(label)) continue
    return label
  }
  return ""
}

const BOT_URL_RE = /^https?:\/\/(t\.me|telegram\.me|telegram\.org)(\/|$)/i

function collectRoutes(text: string, fields: NoticeField[]): NoticeRoute[] {
  const body = normalize(text)
  const region = routeRegion(body)
  const routes: NoticeRoute[] = []
  const seen = new Set<string>()

  function push(name: string, url: string) {
    const cleaned = cleanURL(url)
    if (!cleaned || BOT_URL_RE.test(cleaned)) return
    if (SUBSCRIBE_URL_RE.test(cleaned)) return
    if (region.indexOf(cleaned) < 0) return
    const key = cleaned.replace(/\/+$/, "").toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    routes.push({ name: name.trim(), url: cleaned })
  }

  for (const field of fields) {
    if (field.key && isRouteKey(field.key)) {
      const inline = /https?:\/\//i.exec(field.value)
      if (inline) {
        const url = cleanURL(field.value.slice(inline.index))
        const name = field.value.slice(0, inline.index).replace(/[|｜:=：\s]+$/g, "").trim()
        push(name || field.rawKey.trim(), url)
      } else if (/https?:\/\//i.test(field.value)) {
        push(field.rawKey.trim(), field.value)
      }
      continue
    }
    if (field.key) continue
    push(labelBeforeURL(region, field.value), field.value)
  }

  for (const url of region.match(URL_RE) ?? []) push(labelBeforeURL(region, url), url)

  return routes.map((route, index) => ({
    name: route.name || (index === 0 ? "" : `线路${index + 1}`),
    url: route.url,
  }))
}

const ACCOUNT_LINE_RE = /(用户名称|用户名|登录账号|账号|用户密码|密码)\s*[|｜:=：]/

function splitSegments(text: string): string[] {
  const normalized = normalize(text).trim()
  const parts = normalized
    .split(/(?=【)/)
    .map(part => part.trim())
    .filter(part => !!part && (HAS_URL_RE.test(part) || ACCOUNT_LINE_RE.test(part)))
  return parts.length > 1 ? parts : [normalized]
}

const PRIMARY_NAME_RE = /主线路|主线|主地址|^主$|官方主/

function primaryRouteIndex(routes: NoticeRoute[]): number {
  for (let index = 0; index < routes.length; index++) {
    if (PRIMARY_NAME_RE.test((routes[index].name || "").trim())) return index
  }
  return 0
}

const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443" }

function withPort(url: string, port: string): string {
  if (!url || !/^\d{1,5}$/.test(port)) return url
  const match = /^([A-Za-z][A-Za-z0-9+.\-]*:\/\/)([^/?#]+)([\s\S]*)$/.exec(url)
  if (!match) return url
  const scheme = match[1].slice(0, -3).toLowerCase()
  const authority = match[2]
  if (/:\d+$/.test(authority)) return url
  if ((DEFAULT_PORTS[scheme] ?? "") === port) return url
  return `${match[1]}${authority}:${port}${match[3]}`
}

function buildItem(segment: string): SubscriptionServer | null {
  const fields = parseFields(segment)
  const account = pickUsername(fields, segment)
  const password = pick(fields, isPasswordKey)
  const port = pick(fields, isPortKey)
  const safePassword = pick(fields, field => /安全码|安全密码/.test(field))
  const expire = pick(fields, field => /到期|有效期|过期/.test(field))
  const routes = collectRoutes(segment, fields)

  if (!account && !password && !safePassword && !expire && routes.length === 0) return null

  const at = primaryRouteIndex(routes)
  const primary = routes[at]
  const lines: SubscriptionLine[] = routes
    .map((route, index) => ({ route, index }))
    .filter(item => item.index !== at)
    .map(item => ({
      name: item.route.name || `线路${item.index + 1}`,
      address: item.route.url,
    }))
  const server: SubscriptionServer = {
    name: "",
    type: "emby",
    address: primary ? withPort(primary.url, port) : "",
    account,
    password,
    lines: lines.map(line => ({ name: line.name, address: withPort(line.address, port) })),
  }

  return server
}

export function looksLikeNotice(text: string): boolean {
  if (!text) return false
  const raw = normalize(text)
  if (hasImportLink(raw)) return false
  if (NOTICE_KEYWORDS.some(keyword => raw.indexOf(keyword) >= 0)) return true
  return parseFields(raw).some(field => !!field.key && (isUsernameKey(field.key) || isPasswordKey(field.key)))
}

export function parseNotice(text: string): NoticeResult | null {
  if (!looksLikeNotice(text)) return null
  const items: SubscriptionServer[] = []
  for (const segment of splitSegments(text)) {
    const item = buildItem(segment)
    if (item) items.push(item)
  }
  if (items.length === 0) return null
  return { items }
}
