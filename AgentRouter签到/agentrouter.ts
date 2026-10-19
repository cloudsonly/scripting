// AgentRouter 自动签到 —— 核心逻辑（由 Python 版 agentrouter_checkin.py 移植）
//
// 原理（与线上接口一致）：
//   POST {BASE}/api/user/login  body {username: 邮箱, password: 密码}
//     -> 服务端下发 session cookie，登录响应 data.checked_in === true 即当日签到成功，
//        余额在 data.quota / data.user.quota 中直接返回。
//
//   余额（quota）：
//     GET {BASE}/api/status    -> data.quota_per_unit（本站实测 500000，即 500000 quota = $1）
//     GET {BASE}/api/user/self -> 用签到登录时保存下来的会话（Cookie + New-API-User + Bearer）
//                                 读取最新 quota、used_quota、request_count。
//   刷新余额**不调用登录接口**：登录接口调用太频会被限流返回 4xx，
//   所以只有签到（每天一次）才走 /api/user/login，其余刷新全部复用会话。
//
//   登录成功后再读一次个人日志 /api/log/self/ 做端到端核验：
//     New-API-User 头传 uid，确认存在 type=4 或内容含「签到成功」的当日记录，
//     以排除「登录成功但签到未真正触发」的边界情况。

import { fetch } from "scripting"

export type Account = {
  id: string
  name: string
  email: string
  password: string
}

export type Settings = {
  /** 站点地址，默认 https://agentrouter.org，备用 https://ps.air-outer.com */
  baseUrl: string
  /** 请求超时（秒） */
  timeout: number
  /** 多账号之间的间隔（秒） */
  interval: number
  /** 完成后发送本地通知 */
  notify: boolean
}

export type ResultStatus = "success" | "fail"

export type CheckResult = {
  id: string
  name: string
  status: ResultStatus
  message: string
  username: string
  quota: number | null
  time: string
}

export type Logger = (message: string) => void

/** 单个账号的余额 / 用量快照 */
export type Balance = {
  accountId: string
  name: string
  email: string
  /** 是否成功取到余额 */
  ok: boolean
  /** 剩余额度（new-api 的 quota 原始值，500000 = $1） */
  quota: number | null
  /** 已用额度 */
  usedQuota: number | null
  /** 累计请求次数 */
  requestCount: number | null
  username: string
  displayName: string
  groupName: string
  /** 账号状态：1 正常、2 已禁用、-1 已删除 */
  userStatus: number | null
  /** 余额来源：self = /api/user/self；login = 登录响应兜底 */
  source: "self" | "login"
  /** true 表示需要重新签到登录才有会话，无法刷新余额 */
  needLogin: boolean
  error: string
  time: string
}

/** 签到/登录后保存下来的会话（用于免登录刷新余额） */
export type Session = {
  accountId: string
  base: string
  cookie: string
  uid: string
  accessToken: string
  username: string
  time: string
}

/** 站点换算参数（来自 /api/status） */
export type SiteInfo = {
  perUnit: number
  usdRate: number
  displayInCurrency: boolean
  systemName: string
  time: string
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://agentrouter.org",
  timeout: 20,
  interval: 3,
  notify: true,
}

const LOGIN_PATH = "/api/user/login"
const SELF_LOG_PATH = "/api/log/self/"
const SELF_PATH = "/api/user/self"
const STATUS_PATH = "/api/status"
const SELF_LOG_HEADER = "New-API-User"
const CHECKIN_LOG_TYPE = 4

/**
 * new-api 的额度单位 quota_per_unit：多少 quota 等于 $1。
 * AgentRouter 线上 /api/status 实测返回 quota_per_unit = 500000、usd_exchange_rate = 7.12，
 * 这里作为读不到站点配置时的兜底值。
 */
export const DEFAULT_QUOTA_PER_UNIT = 500000

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"

// ---------- 本地存储 ----------
const STORE_ACCOUNTS = "agentrouter.accounts"
const STORE_SETTINGS = "agentrouter.settings"
const STORE_RESULTS = "agentrouter.lastResults"
const STORE_LAST_RUN = "agentrouter.lastRun"
const STORE_BALANCES = "agentrouter.balances"
const STORE_SITE_INFO = "agentrouter.siteInfo"
const STORE_SESSIONS = "agentrouter.sessions"
const STORE_BALANCE_DAY = "agentrouter.balanceDay"
const STORE_HISTORY = "agentrouter.history"
const KEYCHAIN_PREFIX = "agentrouter.password."

export type HistoryItem = {
  id: string
  time: string
  totalCount: number
  successCount: number
  failCount: number
  totalGainUsd: number
  summary: string
}

type AccountMeta = { id: string; name: string; email: string }

/** 账号元信息存 Storage，密码存钥匙串（Keychain），不落明文。 */
export function loadAccounts(): Account[] {
  try {
    const raw = Storage.get<AccountMeta[]>(STORE_ACCOUNTS)
    if (!Array.isArray(raw)) return []
    return raw.map(item => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? "默认账号"),
      email: String(item.email ?? ""),
      password: loadPassword(String(item.id ?? "")),
    }))
  } catch (e) {
    return []
  }
}

export function saveAccounts(accounts: Account[]): void {
  try {
    const oldMeta = Storage.get<AccountMeta[]>(STORE_ACCOUNTS)
    if (Array.isArray(oldMeta)) {
      const newIds = new Set(accounts.map(a => a.id))
      for (const old of oldMeta) {
        if (old && old.id && !newIds.has(old.id)) {
          removeAccountSecret(old.id)
        }
      }
    }
    Storage.set<AccountMeta[]>(
      STORE_ACCOUNTS,
      accounts.map(a => ({ id: a.id, name: a.name, email: a.email }))
    )
  } catch (e) {
    // 忽略
  }
  for (const a of accounts) savePassword(a.id, a.password)
}

export function removeAccountSecret(id: string): void {
  try {
    Keychain.remove(KEYCHAIN_PREFIX + id)
  } catch (e) {
    // 忽略
  }
}

function savePassword(id: string, password: string): void {
  try {
    if (!password) Keychain.remove(KEYCHAIN_PREFIX + id)
    else Keychain.set(KEYCHAIN_PREFIX + id, password)
  } catch (e) {
    // 忽略
  }
}

function loadPassword(id: string): string {
  try {
    return Keychain.get(KEYCHAIN_PREFIX + id) ?? ""
  } catch (e) {
    return ""
  }
}

export function loadSettings(): Settings {
  try {
    const raw = Storage.get<Partial<Settings>>(STORE_SETTINGS)
    if (raw && typeof raw === "object") {
      return {
        baseUrl: String(raw.baseUrl ?? DEFAULT_SETTINGS.baseUrl),
        timeout: Number(raw.timeout ?? DEFAULT_SETTINGS.timeout) || DEFAULT_SETTINGS.timeout,
        interval: Number(raw.interval ?? DEFAULT_SETTINGS.interval) || 0,
        notify: raw.notify !== false,
      }
    }
  } catch (e) {
    // 忽略
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: Settings): void {
  try {
    Storage.set<Settings>(STORE_SETTINGS, settings)
  } catch (e) {
    // 忽略
  }
}

export function loadLastResults(): CheckResult[] {
  try {
    const raw = Storage.get<CheckResult[]>(STORE_RESULTS)
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

export function saveLastResults(results: CheckResult[]): void {
  try {
    Storage.set<CheckResult[]>(STORE_RESULTS, results)
  } catch (e) {
    // 忽略
  }
}

export function loadLastRun(): string {
  try {
    return Storage.get<string>(STORE_LAST_RUN) ?? ""
  } catch (e) {
    return ""
  }
}

export function saveLastRun(time: string): void {
  try {
    Storage.set<string>(STORE_LAST_RUN, time)
  } catch (e) {
    // 忽略
  }
}

// ---------- 历史记录（最多保留 30 条） ----------
export function loadHistory(): HistoryItem[] {
  try {
    const raw = Storage.get<HistoryItem[]>(STORE_HISTORY)
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

export function saveHistory(items: HistoryItem[]): void {
  try {
    Storage.set<HistoryItem[]>(STORE_HISTORY, items.slice(0, 30))
  } catch (e) {
    // 忽略
  }
}

export function recordHistory(
  results: CheckResult[],
  totalGainUsd = 0
): void {
  if (results.length === 0) return
  const successCount = results.filter(r => r.status === "success").length
  const failCount = results.length - successCount
  const item: HistoryItem = {
    id: "hist_" + Date.now().toString(36),
    time: formatTime(),
    totalCount: results.length,
    successCount,
    failCount,
    totalGainUsd,
    summary: `成功 ${successCount} / 失败 ${failCount}` + (totalGainUsd > 0 ? ` · 收益 +$${totalGainUsd.toFixed(2)}` : ""),
  }
  const history = [item, ...loadHistory()]
  saveHistory(history)
}

export function clearHistory(): void {
  try {
    Storage.remove(STORE_HISTORY)
  } catch (e) {}
}

// ---------- 余额 / 站点配置缓存 ----------
export function loadBalances(): Record<string, Balance> {
  try {
    const raw = Storage.get<Record<string, Balance>>(STORE_BALANCES)
    return raw && typeof raw === "object" ? raw : {}
  } catch (e) {
    return {}
  }
}

export function saveBalances(map: Record<string, Balance>): void {
  try {
    Storage.set<Record<string, Balance>>(STORE_BALANCES, map)
  } catch (e) {
    // 忽略
  }
}

export function loadSiteInfoMap(): Record<string, SiteInfo> {
  try {
    const raw = Storage.get<Record<string, SiteInfo>>(STORE_SITE_INFO)
    return raw && typeof raw === "object" ? raw : {}
  } catch (e) {
    return {}
  }
}

function saveSiteInfoMap(map: Record<string, SiteInfo>): void {
  try {
    Storage.set<Record<string, SiteInfo>>(STORE_SITE_INFO, map)
  } catch (e) {
    // 忽略
  }
}

// ---------- 登录会话（免登录刷新余额用） ----------
export function loadSessions(): Record<string, Session> {
  try {
    const raw = Storage.get<Record<string, Session>>(STORE_SESSIONS)
    return raw && typeof raw === "object" ? raw : {}
  } catch (e) {
    return {}
  }
}

export function loadSession(accountId: string): Session | undefined {
  return loadSessions()[accountId]
}

/** 保存（覆盖）某个账号的会话。 */
export function saveSession(session: Session): void {
  try {
    const map = loadSessions()
    map[session.accountId] = session
    Storage.set<Record<string, Session>>(STORE_SESSIONS, map)
  } catch (e) {
    // 忽略
  }
}

export function clearSession(accountId: string): void {
  try {
    const map = loadSessions()
    if (!(accountId in map)) return
    delete map[accountId]
    Storage.set<Record<string, Session>>(STORE_SESSIONS, map)
  } catch (e) {
    // 忽略
  }
}

// ---------- 余额自动刷新：每天只一次 ----------
/** 当地日期 YYYY-MM-DD */
export function todayStr(date?: Date): string {
  const d = date ?? new Date()
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今天是否已经自动刷新过余额。 */
export function refreshedBalancesToday(): boolean {
  try {
    return String(Storage.get<string>(STORE_BALANCE_DAY) ?? "") === todayStr()
  } catch (e) {
    return false
  }
}

/** 记下今天已经刷过余额。 */
export function markBalanceRefreshed(): void {
  try {
    Storage.set<string>(STORE_BALANCE_DAY, todayStr())
  } catch (e) {
    // 忽略
  }
}

// ---------- 工具 ----------

export function newId(): string {
  return "acct_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function formatTime(date: Date = new Date()): string {
  const p = (n: number) => (n < 10 ? "0" + n : String(n))
  return (
    date.getFullYear() +
    "-" + p(date.getMonth() + 1) +
    "-" + p(date.getDate()) +
    " " + p(date.getHours()) +
    ":" + p(date.getMinutes()) +
    ":" + p(date.getSeconds())
  )
}

/**
 * 智能拆分账号与密码：
 * 兼容常见格式：
 * 1. 邮箱#密码
 * 2. 邮箱----密码（号商常见）
 * 3. 邮箱:密码 / 邮箱：密码
 * 4. 邮箱,密码 / 邮箱，密码
 * 5. 邮箱 \t 密码（制表符）
 * 6. 邮箱 密码（空格分隔）
 */
export function parseAccount(raw: string): [string, string] {
  const s = String(raw ?? "").trim()
  if (!s) return ["", ""]
  if (s.includes("#")) {
    const i = s.indexOf("#")
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()]
  }
  if (s.includes("----")) {
    const i = s.indexOf("----")
    return [s.slice(0, i).trim(), s.slice(i + 4).trim()]
  }
  if (s.includes("\t")) {
    const i = s.indexOf("\t")
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()]
  }
  const sepMatch = s.match(/[:：,，]/)
  if (sepMatch && sepMatch.index !== undefined) {
    const i = sepMatch.index
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()]
  }
  const spaceMatch = s.match(/\s+/)
  if (spaceMatch && spaceMatch.index !== undefined) {
    const i = spaceMatch.index
    return [s.slice(0, i).trim(), s.slice(i + spaceMatch[0].length).trim()]
  }
  return [s.trim(), ""]
}

export type ImportOutcome = {
  accounts: Account[]
  duplicates: number
  total: number
}

/** 批量导入：支持多行多格式识别，自动与已有账号对比去重 */
export function parseImport(text: string, existingAccounts: Account[] = []): ImportOutcome {
  const out: Account[] = []
  const existingSet = new Set(existingAccounts.map(a => a.email.trim().toLowerCase()))
  const seenSet = new Set<string>()
  let duplicates = 0

  const lines = String(text ?? "")
    .split(/[\n\r;；]+/)
    .map(s => s.trim())
    .filter(Boolean)

  for (const line of lines) {
    const [email, password] = parseAccount(line)
    if (email && password) {
      const lower = email.toLowerCase()
      if (existingSet.has(lower) || seenSet.has(lower)) {
        duplicates++
        continue
      }
      seenSet.add(lower)
      out.push({
        id: newId(),
        name: email.split("@")[0] || "默认账号",
        email,
        password,
      })
    }
  }
  return {
    accounts: out,
    duplicates,
    total: out.length + duplicates,
  }
}

/** 从登录响应的 data 中提取余额字段。 */
export function extractQuota(payload: any): number | null {
  if (payload && typeof payload === "object") {
    for (const key of ["quota", "remainder_quota", "balance"]) {
      const v = payload[key]
      if (v !== undefined && v !== null && v !== "") {
        const n = Number(v)
        if (!Number.isNaN(n)) return n
      }
    }
  }
  return null
}

export function formatQuota(quota: number | null): string {
  if (quota === null || quota === undefined) return "未知"
  try {
    return quota.toLocaleString()
  } catch (e) {
    return String(quota)
  }
}

export function normalizeBase(url: string): string {
  const s = String(url ?? "").trim() || DEFAULT_SETTINGS.baseUrl
  return s.replace(/\/+$/, "")
}

export function statusMeta(status: ResultStatus): {
  icon: string
  color: "systemGreen" | "systemRed"
  label: string
} {
  return status === "success"
    ? { icon: "checkmark.circle.fill", color: "systemGreen", label: "成功" }
    : { icon: "xmark.octagon.fill", color: "systemRed", label: "失败" }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms))
}

/** 轻量重试网络请求：面对锁屏刚唤醒或网络波动，遇到抛错时延迟重试 1 次 */
async function fetchWithRetry(
  url: string,
  init: any,
  retries = 1,
  delayMs = 1200
): Promise<any> {
  let lastError: any = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init)
    } catch (e) {
      lastError = e
      if (attempt < retries) {
        await sleep(delayMs)
      }
    }
  }
  throw lastError
}

// ---------- HTTP 细节 ----------

/** Scripting 的 Response.headers 实际是带 map / setCookieList 的对象，这里做兼容取值。 */
function responseHeaders(res: any): Record<string, string> {
  const h = res?.headers
  if (!h) return {}
  if (typeof h === "function") {
    try {
      return (h.call(res) ?? {}) as Record<string, string>
    } catch (e) {
      return {}
    }
  }
  if (h.map && typeof h.map === "object") return h.map as Record<string, string>
  return h as Record<string, string>
}

/** 收集响应里下发的所有 cookie（名=值），拼成请求用的 Cookie 头。 */
function cookieHeader(res: any): string {
  const h = res?.headers
  const list: string[] = Array.isArray(h?.setCookieList) ? h.setCookieList : []
  const pairs: string[] = []
  const add = (raw: string) => {
    const head = String(raw).split(";")[0].trim()
    if (head && head.indexOf("=") > 0 && pairs.indexOf(head) < 0) pairs.push(head)
  }
  if (list.length > 0) {
    list.forEach(add)
  } else {
    const raw = responseHeaders(res)["set-cookie"] ?? ""
    if (raw) raw.split(/,(?=[^;,]+=)/).forEach(add)
  }
  return pairs.join("; ")
}

function failedResult(account: Account, message: string, quota: number | null = null): CheckResult {
  return {
    id: account.id,
    name: account.name || "默认账号",
    status: "fail",
    message,
    username: "",
    quota,
    time: formatTime(),
  }
}

// ===================== 登录 =====================
export type LoginOutcome = {
  ok: boolean
  error: string
  base: string
  cookie: string
  uid: string
  accessToken: string
  /** 登录响应里的用户对象（已兼容 data.user 嵌套与 data 扁平两种结构） */
  user: any
  /** 登录响应的 data 原文 */
  raw: any
}

/** 兼容两种用户信息结构：新版是 data.user，老版直接把用户字段放在 data 上。 */
function extractUser(payload: any): any {
  if (!payload || typeof payload !== "object") return {}
  const nested = (payload as any).user
  if (nested && typeof nested === "object") return nested
  return payload
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj?.[key]
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value)
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

/**
 * 控制台接口的鉴权请求头。
 * new-api 各版本鉴权方式不同，这里把三种常见方式都带上：
 *   Cookie（会话）/ New-API-User（老版控制台接口）/ Authorization: Bearer（新版 access token）。
 */
export function authHeaders(
  base: string,
  opts: { cookie?: string; uid?: string; accessToken?: string; referer?: string }
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    Referer: `${base}${opts.referer ?? "/console"}`,
  }
  if (opts.uid) headers[SELF_LOG_HEADER] = String(opts.uid)
  if (opts.cookie) headers["Cookie"] = opts.cookie
  if (opts.accessToken) headers["Authorization"] = `Bearer ${opts.accessToken}`
  return headers
}

/**
 * 邮箱 + 密码登录站点。
 * 注意：登录失败时 HTTP 仍然是 200，必须判断响应体里的 success 字段。
 */
export async function loginAccount(
  account: Account,
  settings: Settings
): Promise<LoginOutcome> {
  const base = normalizeBase(settings.baseUrl)
  const email = String(account.email ?? "").trim()
  const password = String(account.password ?? "").trim()
  const empty: LoginOutcome = {
    ok: false,
    error: "",
    base,
    cookie: "",
    uid: "",
    accessToken: "",
    user: {},
    raw: null,
  }

  if (!email || !password) return { ...empty, error: "未配置邮箱/密码，跳过" }

  let res: any
  try {
    res = await fetchWithRetry(`${base}${LOGIN_PATH}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Referer: `${base}/login`,
        Origin: base,
      },
      body: JSON.stringify({ username: email, password }),
      timeout: settings.timeout,
    })
  } catch (e) {
    return { ...empty, error: `登录请求异常: ${String(e)}` }
  }

  const headers = responseHeaders(res)
  if (String(headers["content-type"] ?? "").indexOf("text/html") >= 0) {
    return { ...empty, error: "登录接口返回 HTML（可能被 WAF 拦截或路径变化）" }
  }

  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { ...empty, error: `登录响应非 JSON(HTTP ${res.status}): ${text.slice(0, 120)}` }
  }

  if (!json || !json.success) {
    return { ...empty, error: `登录失败: ${(json && json.message) || text.slice(0, 120)}` }
  }

  const data = (json.data ?? {}) as any
  const user = extractUser(data)
  const uidValue = user.id ?? data.id
  return {
    ok: true,
    error: "",
    base,
    cookie: cookieHeader(res),
    uid: uidValue === undefined || uidValue === null ? "" : String(uidValue),
    accessToken: String(data.access_token ?? ""),
    user,
    raw: data,
  }
}

// ===================== 账号密码登录（签到） =====================
export async function passwordLogin(
  account: Account,
  settings: Settings,
  log: Logger
): Promise<CheckResult> {
  const name = account.name || "默认账号"

  log(`====== 开始处理账号（账号密码登录）：${name} ======`)

  const login = await loginAccount(account, settings)
  if (!login.ok) {
    const res = failedResult(account, login.error)
    logResult(res, log)
    return res
  }

  const data = (login.raw ?? {}) as any
  let user = (login.user ?? {}) as any
  const checkedIn = !!(user.checked_in ?? data.checked_in)
  const username = user.username || user.display_name || account.email
  let quota = extractQuota(user)
  const uid = login.uid
  const cookies = login.cookie

  // 把这次登录的会话存下来：以后刷新余额直接用会话请求 /api/user/self，
  // 不再调登录接口（登录接口调得太频会被限流返回 4xx）。
  const session: Session = {
    accountId: account.id,
    base: login.base,
    cookie: cookies,
    uid,
    accessToken: login.accessToken,
    username: String(username ?? ""),
    time: formatTime(),
  }
  saveSession(session)

  // 用刚拿到的会话再读一次用户信息：拿到签到后的最新余额
  // （登录响应里的额度可能是签到前的，这里补一次才算“本次签到后的余额”）
  const self = await getUserSelf(login.base, session, settings)
  if (self.ok) {
    user = self.user
    const fresh = pickNumber(user, ["quota", "remainder_quota", "balance"])
    if (fresh !== null) quota = fresh
  } else {
    log(`[${name}] 未能读取最新余额（沿用登录响应里的额度）：${self.error}`)
  }

  const balanceText = formatUsd(quota, loadPerUnit(settings))

  let message: string
  let status: ResultStatus = "success"
  const verify = await verifyCheckin(login.base, cookies, uid, settings)
  const verified = verify.level === "new" || verify.level === "today"
  if (checkedIn) {
    message = verified
      ? `签到成功，日志已确认（${verify.detail}）`
      : `登录成功且服务端返回已签到，但日志未确认: ${verify.detail}`
  } else if (verified) {
    // checked_in 为假但日志中有当日记录，说明今天已经签到过，不需要重复签到。
    message = `今日已签到（${verify.detail}，无需重复）`
  } else {
    status = "fail"
    message = `登录成功但未签到成功（${verify.detail}）`
  }
  message += ` · 本次余额 ${balanceText}`

  const result: CheckResult = {
    id: account.id,
    name,
    status,
    message,
    username: String(username ?? ""),
    quota,
    time: formatTime(),
  }
  logResult(result, log)
  return result
}

function logResult(result: CheckResult, log: Logger): void {
  const meta = statusMeta(result.status)
  log(
    `[${result.name}] ${meta.label} | ${result.message} | 额度: ${formatQuota(result.quota)}`
  )
}

// ===================== 签到日志核验 =====================
type VerifyResult = {
  level: "new" | "today" | "none" | "error"
  detail: string
}

function normalizeTimestamp(raw: any): number | null {
  if (typeof raw === "number") {
    // 兼容毫秒戳 (> 1e11) 和秒戳
    return raw > 1e11 ? Math.floor(raw / 1000) : Math.floor(raw)
  }
  if (typeof raw === "string") {
    let s = raw.trim()
    if (!s) return null
    // 兼容不带时区的本地时间字符串 "2026-09-13 12:00:00"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
      s = s.replace(" ", "T")
    }
    const parsed = Math.floor(new Date(s).getTime() / 1000)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

async function verifyCheckin(
  base: string,
  cookies: string,
  uid: any,
  settings: Settings,
  slackNew = 300,
  windowDays = 1
): Promise<VerifyResult> {
  if (!uid) return { level: "error", detail: "缺少 uid，跳过日志核验" }

  let res: any
  try {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: `${base}/console/log`,
      [SELF_LOG_HEADER]: String(uid),
    }
    if (cookies) headers["Cookie"] = cookies
    res = await fetch(`${base}${SELF_LOG_PATH}?p=1&page_size=20`, {
      method: "GET",
      headers,
      timeout: settings.timeout,
    })
  } catch (e) {
    return { level: "error", detail: `日志查询异常: ${String(e)}` }
  }

  const ct = String(responseHeaders(res)["content-type"] ?? "")
  if (res.status !== 200 || ct.indexOf("text/html") >= 0) {
    return { level: "error", detail: `日志接口返回 HTTP ${res.status}` }
  }

  let items: any[] = []
  try {
    const json: any = await res.json()
    items = (json?.data?.items ?? []) as any[]
  } catch (e) {
    return { level: "error", detail: `日志响应解析失败: ${String(e)}` }
  }

  const now = Math.floor(Date.now() / 1000)
  let newestTs: number | null = null
  let newestContent: string | null = null

  for (const item of items) {
    const content = String(item?.content ?? "")
    if (content.indexOf("签到成功") >= 0 || item?.type === CHECKIN_LOG_TYPE) {
      const ts = normalizeTimestamp(item?.created_at)
      if (ts !== null && (newestTs === null || ts > newestTs)) {
        newestTs = ts
        newestContent = content
      }
    }
  }

  if (newestTs === null) return { level: "none", detail: "日志中未找到任何签到记录" }

  const ago = now - newestTs
  let agoStr: string
  if (ago < 60) agoStr = `${ago} 秒前`
  else if (ago < 3600) agoStr = `${Math.floor(ago / 60)} 分钟前`
  else if (ago < 86400) agoStr = `${Math.floor(ago / 3600)} 小时前`
  else agoStr = `${Math.floor(ago / 86400)} 天前`

  if (newestTs >= now - slackNew) {
    return { level: "new", detail: `本次运行已生成签到日志（${agoStr}）` }
  }
  if (newestTs >= now - windowDays * 86400) {
    return { level: "today", detail: `近 ${windowDays} 天内有签到记录（${agoStr}），本次未新增` }
  }
  return { level: "none", detail: `最近一条签到日志较旧（${agoStr}）` }
}

// ===================== 余额 / 用量 =====================

/**
 * 读取站点换算参数：GET /api/status 会返回 quota_per_unit。
 * AgentRouter 线上实测：quota_per_unit = 500000（即 500000 quota = $1）、
 * usd_exchange_rate = 7.12、display_in_currency = true。
 */
export async function fetchSiteInfo(settings: Settings): Promise<SiteInfo> {
  const base = normalizeBase(settings.baseUrl)
  const fallback: SiteInfo = {
    perUnit: DEFAULT_QUOTA_PER_UNIT,
    usdRate: 0,
    displayInCurrency: true,
    systemName: "",
    time: "",
  }
  try {
    const res = await fetch(`${base}${STATUS_PATH}`, {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" },
      timeout: settings.timeout,
    })
    const json: any = await res.json()
    const data = (json?.data ?? {}) as any
    const perUnit = Number(data.quota_per_unit)
    const info: SiteInfo = {
      perUnit: Number.isFinite(perUnit) && perUnit > 0 ? perUnit : DEFAULT_QUOTA_PER_UNIT,
      usdRate: Number(data.usd_exchange_rate) || 0,
      displayInCurrency: data.display_in_currency !== false,
      systemName: String(data.system_name ?? ""),
      time: formatTime(),
    }
    const map = loadSiteInfoMap()
    map[base] = info
    saveSiteInfoMap(map)
    return info
  } catch (e) {
    return fallback
  }
}

/** 缓存中该站点的 quota 单位。 */
export function loadPerUnit(settings: Settings): number {
  const info = loadSiteInfoMap()[normalizeBase(settings.baseUrl)]
  return info && info.perUnit > 0 ? info.perUnit : DEFAULT_QUOTA_PER_UNIT
}

/** quota → 美元。 */
export function quotaToUsd(quota: number | null, perUnit: number): number | null {
  if (quota === null || quota === undefined) return null
  const n = Number(quota)
  if (!Number.isFinite(n)) return null
  const unit = Number.isFinite(perUnit) && perUnit > 0 ? perUnit : DEFAULT_QUOTA_PER_UNIT
  return n / unit
}

/** 展示用金额：$25.00 / $1,250 */
export function formatUsd(quota: number | null, perUnit: number): string {
  const usd = quotaToUsd(quota, perUnit)
  if (usd === null) return "未知"
  const fixed = Math.abs(usd) >= 1000 ? usd.toFixed(0) : usd.toFixed(2)
  const parts = fixed.split(".")
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `$${parts.length > 1 ? `${int}.${parts[1]}` : int}`
}

/** 账号状态文案。 */
export function userStatusLabel(status: number | null): string {
  if (status === null) return ""
  if (status === 1) return "正常"
  if (status === 2) return "已禁用"
  if (status === -1) return "已删除"
  return `状态 ${status}`
}

/**
 * 用已有的登录会话读取用户信息（**不走登录接口**）。
 * 登录接口调用频繁会被限流返回 4xx，所以刷新余额只用会话。
 */
async function getUserSelf(
  base: string,
  session: Session,
  settings: Settings
): Promise<{ ok: boolean; user: any; error: string; status: number }> {
  try {
    const res = await fetchWithRetry(`${base}${SELF_PATH}`, {
      method: "GET",
      headers: authHeaders(base, {
        cookie: session.cookie,
        uid: session.uid,
        accessToken: session.accessToken,
        referer: "/console/personal",
      }),
      timeout: settings.timeout,
    })
    const contentType = String(responseHeaders(res)["content-type"] ?? "")
    if (res.status === 200 && contentType.indexOf("text/html") < 0) {
      const json: any = await res.json()
      if (json?.success) return { ok: true, user: extractUser(json.data), error: "", status: 200 }
      return {
        ok: false,
        user: {},
        error: `读取用户信息失败：${json?.message ?? "未知错误"}`,
        status: 200,
      }
    }
    return { ok: false, user: {}, error: `读取用户信息失败：HTTP ${res.status}`, status: res.status }
  } catch (e) {
    return { ok: false, user: {}, error: `读取用户信息异常：${String(e)}`, status: 0 }
  }
}

/**
 * 拉取单个账号的余额与用量：**只用签到/登录时保存下来的会话**请求 /api/user/self，
 * 不再调用登录接口（登录接口调用太频繁会被限流）。
 * 会话缺失或失效时返回 needLogin，提示用户去签到一次重新拿会话。
 */
export async function fetchBalance(account: Account, settings: Settings): Promise<Balance> {
  const base = normalizeBase(settings.baseUrl)
  const name = account.name || "默认账号"
  const email = String(account.email ?? "").trim()
  const stamp = formatTime()
  const empty: Balance = {
    accountId: account.id,
    name,
    email,
    ok: false,
    quota: null,
    usedQuota: null,
    requestCount: null,
    username: "",
    displayName: "",
    groupName: "",
    userStatus: null,
    source: "self",
    needLogin: false,
    error: "",
    time: stamp,
  }

  const session = loadSession(account.id)
  if (!session || !session.cookie) {
    return { ...empty, needLogin: true, error: "还没有登录会话，请先点「签到」登录一次" }
  }
  if (normalizeBase(session.base) !== base) {
    return { ...empty, needLogin: true, error: "站点地址已变更，请重新签到登录" }
  }

  const self = await getUserSelf(base, session, settings)
  if (!self.ok) {
    if (self.status === 401 || self.status === 403) {
      clearSession(account.id)
      return { ...empty, needLogin: true, error: "登录会话已失效，请重新签到登录" }
    }
    return { ...empty, error: self.error }
  }

  const user = self.user as any
  const quota = pickNumber(user, ["quota", "remainder_quota", "balance"])
  return {
    accountId: account.id,
    name,
    email,
    ok: quota !== null,
    quota,
    usedQuota: pickNumber(user, ["used_quota"]),
    requestCount: pickNumber(user, ["request_count"]),
    username: String(user.username ?? session.username ?? ""),
    displayName: String(user.display_name ?? ""),
    groupName: String(user.group ?? ""),
    userStatus: pickNumber(user, ["status"]),
    source: "self",
    needLogin: false,
    error: quota === null ? "响应中未包含额度字段" : "",
    time: stamp,
  }
}

/** 批量刷新余额（逐账号，带间隔，结果写入缓存；不调用登录接口）。 */
export async function refreshBalances(
  accounts: Account[],
  settings: Settings,
  perUnit: number,
  log: Logger,
  onOne?: (balance: Balance, done: number, total: number) => void
): Promise<Record<string, Balance>> {
  const out: Record<string, Balance> = {}
  let anyOk = false
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]
    try {
      const balance = await fetchBalance(account, settings)
      out[account.id] = balance
      if (balance.ok) anyOk = true
      log(
        `[${balance.name}] 余额 ${formatUsd(balance.quota, perUnit)}` +
          (balance.usedQuota !== null
            ? `，已用 ${formatUsd(balance.usedQuota, perUnit)}`
            : "") +
          (balance.error ? `（${balance.error}）` : "")
      )
      onOne?.(balance, i + 1, accounts.length)
    } catch (e) {
      log(`[${account?.name ?? "?"}] 读取余额异常: ${String(e)}`)
    }
    if (accounts.length > 1 && i < accounts.length - 1) {
      await sleep(Math.max(0, settings.interval) * 1000)
    }
  }
  if (Object.keys(out).length > 0) saveBalances({ ...loadBalances(), ...out })
  // 只有真的拿到过余额才算“今天刷过了”，免得会话失效时空跑一次就不管了
  if (anyOk) markBalanceRefreshed()
  return out
}

// ===================== 调度 =====================
export async function doCheckin(
  account: Account,
  settings: Settings,
  log: Logger
): Promise<CheckResult> {
  const email = String(account.email ?? "").trim()
  const password = String(account.password ?? "").trim()
  if (email && password) return passwordLogin(account, settings, log)
  const res = failedResult(account, "账号未配置邮箱/密码，跳过")
  logResult(res, log)
  return res
}

/** 单个账号独立签到 */
export async function checkinSingle(
  account: Account,
  settings: Settings,
  log: Logger = (msg: string) => console.log(msg)
): Promise<CheckResult> {
  return doCheckin(account, settings, log)
}

export async function runAll(
  accounts: Account[],
  settings: Settings,
  log: Logger,
  onResult?: (result: CheckResult, done: number, total: number) => void
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]
    try {
      const result = await doCheckin(account, settings, log)
      results.push(result)
      onResult?.(result, results.length, accounts.length)
    } catch (e) {
      log(`[${account?.name ?? "?"}] 处理异常: ${String(e)}`)
    }
    if (accounts.length > 1 && i < accounts.length - 1) {
      await sleep(Math.max(0, settings.interval) * 1000)
    }
  }
  return results
}

export function summaryLines(results: CheckResult[]): string[] {
  return results.map(r => {
    const meta = statusMeta(r.status)
    const who = r.username || r.name
    return `${meta.label}｜${r.name}（${who}）：${r.message}　额度 ${formatQuota(r.quota)}`
  })
}

export function buildNotification(
  results: CheckResult[]
): { title: string; body: string } {
  if (results.length === 0) {
    return { title: "[AgentRouter] 签到失败", body: "所有账号均未成功执行" }
  }
  const failed = results.filter(r => r.status === "fail").length
  const ok = results.length - failed
  const title = failed === 0 ? "[AgentRouter] 签到汇总 ✅" : `[AgentRouter] 签到汇总（成功 ${ok}/${results.length}）`
  const head = summaryLines(results)[0] ?? ""
  return {
    title,
    body: results.length === 1 ? head : summaryLines(results).join("\n"),
  }
}
