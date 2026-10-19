/**
 * 识别「创建用户成功 / 恢复成功」这类开通通知，抽取账号、密码、安全密码、到期时间与线路。
 * 规则参考用户自己的「Emby 导入助手」里的 parse.ts（字段行、内联账号、线路命名等）。
 *
 * 例：
 *   【创建用户成功🎉
 *   · 用户名称 | test
 *   · 用户密码 | 123456
 *   · 安全密码 | 12345（仅发送一次）
 *   · 到期时间 | 2026-01-01 12:00:00
 *   · 当前线路：
 *   主线路:
 *   https://emby.example.com:443
 *   线路一:
 *   https://line1.example.com:443
 *   …
 */

import type { SubscriptionLine, SubscriptionServer } from "./subscription"

export interface NoticeItem {
  server: SubscriptionServer
  /** 供展示/编辑页用的摘要，例如「账号 test · 安全密码 12345 · 到期 2026-01-01」 */
  note: string
}

export interface NoticeResult {
  items: NoticeItem[]
  summary: string
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
  // 简写形式（如「线路：https://… 用户名：xx 密码：xx」）
  "线路",
  "用户名",
  "密码",
]

/** 非 http(s) 的 `scheme://…?` 视为导入链接：有链接时就按链接解析，不走通知分支 */
const IMPORT_LINK_RE = /[A-Za-z][A-Za-z0-9+.\-]*:\/\/(?!https?:)[^\s]*\?/i

const FIELD_RE = /^[·•▎●▪‣*\s\u3000]*([^=|｜：:]+?)\s*(?:=|\||｜|：|:)\s*(.*)$/
const URL_RE = /https?:\/\/[^\s<>"'，。；;、）》】］]+/gi

/** 用户名优先顺序（对齐「Emby 导入助手」） */
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
  return value
    .trim()
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
  return /用户密码|登录密码|登陆密码|^密码$|^pass$|^passwd$|^pwd$|password|口令/.test(key)
}

function isRouteKey(key: string): boolean {
  return /线路|地址|直连|反代|backup|address|server_url|^url$/.test(key)
}

interface NoticeField {
  /** 规范化后的字段名（裸 URL 行是空字符串） */
  key: string
  /** 原始字段名（用于给线路命名） */
  rawKey: string
  value: string
}

/** 逐行解析「· 名称 | 值」式字段，支持值写在下一行（当前线路：换行后写地址） */
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

/** 行首的项目符号（通知里很常见） */
const BULLET_RE = /^[·•▎●▪‣\s　]+/

/**
 * 线路名 = 地址前面紧邻的那段原文标签（「主线路:」换行写地址、「电信线路 https://…」同行都行）。
 * 只认原文，不从域名推、不猜关键词。找不到就返回空。
 */
function labelBeforeURL(text: string, url: string): string {
  const at = text.indexOf(url)
  if (at <= 0) return ""
  // 先抹掉更早出现的地址，否则会把上一条 URL 的尾巴（…/emby、:443）当成名称
  const head = text.slice(0, at).replace(URL_RE, " ")
  const lines = head.split("\n")
  let index = lines.length - 1
  while (index >= 0 && !lines[index].trim()) index--
  if (index < 0) return ""
  const label = lines[index].replace(/[|｜:=：\s]+$/g, "").replace(BULLET_RE, "").trim()
  if (!label || label.length > 20) return ""
  // 「字段名：值」这种行，尾巴是值（密码、账号），不是线路名
  if (/[|｜:=：]/.test(label)) return ""
  if (!/[A-Za-z\u4e00-\u9fff]/.test(label)) return ""
  return label
}

/** 通知里的机器人 / 频道链接不是线路 */
const BOT_URL_RE = /^https?:\/\/(t\.me|telegram\.me|telegram\.org)(\/|$)/i

/** 收集线路：带名字的字段优先，裸 URL 兜底，按 URL 去重 */
function collectRoutes(text: string, fields: NoticeField[]): NoticeRoute[] {
  const body = normalize(text)
  const routes: NoticeRoute[] = []
  const seen = new Set<string>()

  function push(name: string, url: string) {
    const cleaned = cleanURL(url)
    if (!cleaned || BOT_URL_RE.test(cleaned)) return
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
    push(labelBeforeURL(body, field.value), field.value)
  }

  for (const url of body.match(URL_RE) ?? []) push(labelBeforeURL(body, url), url)

  return routes.map((route, index) => ({
    name: route.name || (index === 0 ? "" : `线路${index + 1}`),
    url: route.url,
  }))
}

/** 以 【 为界把多段通知拆开 */
function splitSegments(text: string): string[] {
  const normalized = normalize(text).trim()
  const parts = normalized
    .split(/(?=【)/)
    .map(part => part.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : [normalized]
}

function buildItem(segment: string): NoticeItem | null {
  const fields = parseFields(segment)
  const account = pickUsername(fields, segment)
  const password = pick(fields, isPasswordKey)
  const safePassword = pick(fields, field => /安全码|安全密码/.test(field))
  const expire = pick(fields, field => /到期|有效期|过期/.test(field))
  const siteAccount = pick(fields, field => /网站账号|网页账号/.test(field))
  const routes = collectRoutes(segment, fields)

  if (!account && !password && !safePassword && !expire && routes.length === 0) return null

  const primary = routes[0]
  const lines: SubscriptionLine[] = routes.slice(1).map((route, index) => ({
    name: route.name || `线路${index + 2}`,
    address: route.url,
  }))
  const server: SubscriptionServer = {
    // 通知里写的是地址和账号，没有服务器名称；留空让目标 App 自己显示，别拿域名或账号顶
    name: "",
    type: "emby",
    address: primary ? primary.url : "",
    account,
    password,
    lines,
  }

  const parts: string[] = []
  if (account) parts.push(`账号 ${account}`)
  if (siteAccount && siteAccount !== account) parts.push(`网站账号 ${siteAccount}`)
  if (safePassword) parts.push(`安全密码 ${safePassword}`)
  if (expire) parts.push(`到期 ${expire}`)
  if (routes.length > 1) parts.push(`主地址 + ${routes.length - 1} 条备用线路`)
  else if (routes.length === 1) parts.push("仅主地址")

  return { server, note: parts.join(" · ") }
}

export function looksLikeNotice(text: string): boolean {
  if (!text) return false
  const raw = normalize(text)
  // 已经有导入链接 → 交给链接解析，避免把链接误当成通知
  if (IMPORT_LINK_RE.test(raw)) return false
  if (NOTICE_KEYWORDS.some(keyword => raw.indexOf(keyword) >= 0)) return true
  // 没有关键词，但出现了「用户名/账号/密码：xxx」这类字段行，也算通知
  return parseFields(raw).some(field => !!field.key && (isUsernameKey(field.key) || isPasswordKey(field.key)))
}

/** 解析开通/恢复通知；不是通知文本时返回 null */
export function parseNotice(text: string): NoticeResult | null {
  if (!looksLikeNotice(text)) return null
  const items: NoticeItem[] = []
  for (const segment of splitSegments(text)) {
    const item = buildItem(segment)
    if (item) items.push(item)
  }
  if (items.length === 0) return null
  return {
    items,
    summary: items.map(item => item.note).filter(Boolean).join("；"),
  }
}
