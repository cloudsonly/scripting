import {
  Navigation,
  NavigationStack,
  List,
  Section,
  ForEach,
  HStack,
  VStack,
  Text,
  Button,
  Image,
  Spacer,
  ProgressView,
  TextField,
  SecureField,
  Toggle,
  useState,
  useEffect,
  useRef,
  Notification,
} from "scripting"
import {
  Account,
  Settings,
  Balance,
  CheckResult,
  DEFAULT_SETTINGS,
  DEFAULT_QUOTA_PER_UNIT,
  newId,
  formatTime,
  parseImport,
  formatUsd,
  statusMeta,
  userStatusLabel,
  loadAccounts,
  saveAccounts,
  removeAccountSecret,
  loadSettings,
  saveSettings,
  loadLastResults,
  saveLastResults,
  loadLastRun,
  saveLastRun,
  loadBalances,
  saveBalances,
  loadPerUnit,
  refreshedBalancesToday,
  markBalanceRefreshed,
  fetchSiteInfo,
  fetchBalance,
  refreshBalances,
  runAll,
  checkinSingle,
  buildNotification,
  loadHistory,
  recordHistory,
  clearHistory,
  type HistoryItem,
} from "./agentrouter"

type EditorResult =
  | { action: "save"; account: Account }
  | { action: "delete"; id: string }

type FieldKeyboard = "default" | "emailAddress" | "numberPad" | "URL" | "decimalPad"

/**
 * 列表行式的「标签 + 输入框」。
 * 说明：TextField/SecureField 的 title 只在空值时当作占位显示，
 * 填了内容就看不到字段名，所以这里自绘左侧标签。
 */
function LabeledField(props: {
  label: string
  value: string
  onChanged: (value: string) => void
  placeholder?: string
  secure?: boolean
  keyboardType?: FieldKeyboard
  labelWidth?: number
}) {
  const shared = {
    title: "",
    value: props.value,
    onChanged: props.onChanged,
    frame: { maxWidth: "infinity" as const },
    multilineTextAlignment: "trailing" as const,
  }
  return (
    <HStack spacing={8}>
      <Text font="body" frame={{ width: props.labelWidth ?? 76, alignment: "leading" }}>
        {props.label}
      </Text>
      {props.secure ? (
        <SecureField {...shared} />
      ) : (
        <TextField
          {...shared}
          prompt={props.placeholder}
          keyboardType={props.keyboardType ?? "default"}
          autocorrectionDisabled
          textInputAutocapitalization="never"
        />
      )}
    </HStack>
  )
}

/** 添加 / 编辑单个账号（表单页，以 formSheet 弹出） */
export function AccountEditor(props: { account: Account | null }) {
  const dismiss = Navigation.useDismiss()
  const isNew = props.account == null
  const [name, setName] = useState(props.account?.name ?? "")
  const [email, setEmail] = useState(props.account?.email ?? "")
  const [password, setPassword] = useState(props.account?.password ?? "")
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  const canSave = email.trim().length > 0 && password.trim().length > 0

  const submit = () => {
    if (!canSave) {
      setError("邮箱和密码都不能为空")
      return
    }
    const account: Account = {
      id: props.account?.id ?? newId(),
      name: name.trim() || "默认账号",
      email: email.trim(),
      password: password.trim(),
    }
    dismiss({ action: "save", account } as EditorResult)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={isNew ? "添加账号" : "编辑账号"}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
          confirmationAction: (
            <Button title="保存" action={submit} disabled={!canSave} />
          ),
        }}
        alert={{
          title: "删除该账号？",
          message: <Text>删除后需要重新输入密码。</Text>,
          isPresented: confirmDelete,
          onChanged: setConfirmDelete,
          actions: (
            <>
              <Button title="取消" action={() => setConfirmDelete(false)} />
              <Button
                title="删除"
                role="destructive"
                action={() => {
                  setConfirmDelete(false)
                  dismiss({ action: "delete", id: props.account?.id ?? "" } as EditorResult)
                }}
              />
            </>
          ),
        }}
      >
        <Section title="账号信息">
          <LabeledField
            label="备注"
            placeholder="主账号"
            value={name}
            onChanged={setName}
          />
          <LabeledField
            label="邮箱"
            placeholder="you@example.com"
            value={email}
            onChanged={setEmail}
            keyboardType="emailAddress"
          />
          <LabeledField
            label="密码"
            value={password}
            onChanged={setPassword}
            secure
          />
        </Section>
        {error ? (
          <Section>
            <Text font="footnote" foregroundStyle="systemRed">{error}</Text>
          </Section>
        ) : null}
        {!isNew ? (
          <Section>
            <Button
              title="删除该账号"
              role="destructive"
              action={() => setConfirmDelete(true)}
            />
          </Section>
        ) : null}
        <Section title="说明">
          <Text font="footnote" foregroundStyle="secondaryLabel">
            密码仅保存在本机钥匙串（Keychain），不会上传到「脚本」App 以外的任何地方。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

export function ResultRow(props: { result: CheckResult; perUnit: number }) {
  const meta = statusMeta(props.result.status)
  return (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={8}>
        <Image systemName={meta.icon} foregroundStyle={meta.color} />
        <Text font="headline">{props.result.name}</Text>
        <Spacer />
        <Text font="footnote" foregroundStyle="secondaryLabel">
          余额 {formatUsd(props.result.quota, props.perUnit)}
        </Text>
      </HStack>
      <Text font="subheadline" foregroundStyle="secondaryLabel">
        {props.result.message}
      </Text>
      <Text font="caption" foregroundStyle="tertiaryLabel">
        {props.result.time}
      </Text>
    </VStack>
  )
}

export function MainView(props: { onDismiss?: () => void; autoRefresh?: boolean }) {
  const dismissSheet = Navigation.useDismiss()
  const dismiss = () => {
    if (props.onDismiss) props.onDismiss()
    else dismissSheet(null)
  }

  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts())
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [results, setResults] = useState<CheckResult[]>(() => loadLastResults())
  const [lastRun, setLastRun] = useState<string>(() => loadLastRun())
  const [balances, setBalances] = useState<Record<string, Balance>>(() => loadBalances())
  const [perUnit, setPerUnit] = useState<number>(() => loadPerUnit(loadSettings()))
  const [gains, setGains] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  const [refreshing, setRefreshing] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState("")
  const [balanceNote, setBalanceNote] = useState("")
  // 余额的最新副本：供异步回调（签到中 / 刷新中）读写，避免拿到过期的 state
  const balancesRef = useRef<Record<string, Balance>>(balances)

  const commitBalances = (next: Record<string, Balance>) => {
    balancesRef.current = next
    saveBalances(next)
    setBalances(next)
  }

  useEffect(() => {
    saveLastResults(results)
  }, [results])

  useEffect(() => {
    saveLastRun(lastRun)
  }, [lastRun])

  // 每天首次进入主界面时自动刷一次余额；其余时间只手动刷新
  useEffect(() => {
    if (props.autoRefresh === false) return
    if (loadAccounts().length === 0) return
    if (refreshedBalancesToday()) {
      setBalanceNote("今日已自动刷新过，需更新请点「刷新余额」")
      return
    }
    void refreshAll(true)
  }, [])

  /** 右上角入口：账号管理与设置 */
  const openAccounts = async () => {
    const outcome = (await Navigation.present({
      element: <AccountsView />,
      modalPresentationStyle: "formSheet",
    })) as AccountsOutcome | null
    if (!outcome) return
    setAccounts(outcome.accounts)
    setSettings(outcome.settings)
    if (outcome.accounts.length > 0) void refreshAll(true, outcome.settings)
    else setBalanceNote("")
  }

  const applyBalance = (balance: Balance) => {
    commitBalances({ ...balancesRef.current, [balance.accountId]: balance })
  }

  /**
   * 把签到结果里的余额并进余额列表。
   * 签到的时候已经用会话取过最新余额，所以这里**不再联网**，避免多余的登录/接口调用。
   */
  const applyResultBalance = (
    result: CheckResult,
    before: Record<string, Balance>
  ) => {
    if (result.quota === null) return
    const previous = before[result.id]?.quota ?? null
    if (previous !== null && result.quota > previous) {
      const gain = result.quota - previous
      setGains(prev => ({ ...prev, [result.id]: gain }))
    }
    const old = balancesRef.current[result.id]
    applyBalance({
      accountId: result.id,
      name: result.name,
      email: accounts.find(a => a.id === result.id)?.email ?? old?.email ?? "",
      ok: true,
      quota: result.quota,
      usedQuota: old?.usedQuota ?? null,
      requestCount: old?.requestCount ?? null,
      username: result.username || old?.username || "",
      displayName: old?.displayName ?? "",
      groupName: old?.groupName ?? "",
      userStatus: old?.userStatus ?? null,
      source: "self",
      needLogin: false,
      error: "",
      time: result.time,
    })
    markBalanceRefreshed()
  }

  /** 刷新全部账号余额（silent = 不显示“正在读取”提示） */
  const refreshAll = async (silent: boolean, useSettings?: Settings) => {
    const active = useSettings ?? settings
    const list = loadAccounts()
    if (list.length === 0) {
      if (!silent) setBalanceNote("请先在右上角「账号」里添加账号")
      return
    }
    setRefreshing(true)
    if (!silent) setBalanceNote("正在读取余额…")
    try {
      const info = await fetchSiteInfo(active)
      setPerUnit(info.perUnit)
      const map = await refreshBalances(
        list,
        active,
        info.perUnit,
        (message: string) => console.log(message),
        (balance: Balance, done: number, total: number) => {
          applyBalance(balance)
          setBalanceNote(`读取余额：${done}/${total}`)
        }
      )
      commitBalances({ ...balancesRef.current, ...map })
      const values = Object.keys(map).map(key => map[key])
      if (values.some(item => item.needLogin) && !values.some(item => item.ok)) {
        setBalanceNote("需要先点「签到」登录一次，之后余额就能免登录刷新")
      } else {
        setBalanceNote(
          `余额已更新 · ${formatTime()}` + (info.systemName ? ` · ${info.systemName}` : "")
        )
      }
    } catch (e) {
      setBalanceNote(`读取余额失败：${String(e)}`)
    } finally {
      setRefreshing(false)
    }
  }

  /** 只刷新单个账号（点一下余额行） */
  const refreshOne = async (account: Account) => {
    if (refreshing) return
    setRefreshing(true)
    setBalanceNote(`正在读取 ${account.name} 的余额…`)
    try {
      const balance = await fetchBalance(account, settings)
      applyBalance(balance)
      setBalanceNote(
        balance.ok
          ? `${account.name}：${formatUsd(balance.quota, perUnit)} · ${balance.time}`
          : `${account.name}：${balance.error || "未取到余额"}`
      )
    } catch (e) {
      setBalanceNote(`读取失败：${String(e)}`)
    } finally {
      setRefreshing(false)
    }
  }

  /** 单独签到某一个账号 */
  const checkinOne = async (account: Account) => {
    if (running) return
    setRunning(true)
    setProgress(`正在签到 ${account.name}…`)
    const before = balancesRef.current
    try {
      const result = await checkinSingle(account, settings)
      setResults(prev => [result, ...prev.filter(r => r.id !== result.id)])
      setLastRun(formatTime())
      applyResultBalance(result, before)
      const prevQuota = before[result.id]?.quota
      const gainUsd =
        result.quota !== null && prevQuota !== null && prevQuota !== undefined && result.quota > prevQuota
          ? (result.quota - prevQuota) / perUnit
          : 0
      recordHistory([result], gainUsd)
      setHistory(loadHistory())
      setProgress(`${account.name}：${result.status === "success" ? "签到成功" : "签到失败"}`)
      if (settings.notify) {
        await Notification.schedule({
          title: `[AgentRouter] ${account.name} ${result.status === "success" ? "签到成功 ✅" : "签到失败 ❌"}`,
          body: result.message,
          threadIdentifier: "agentrouter",
        })
      }
    } catch (e) {
      setProgress(`签到异常: ${String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  const start = async () => {
    if (running) return
    if (accounts.length === 0) {
      setProgress("请先添加账号")
      return
    }
    setRunning(true)
    setProgress("正在签到…")
    const collected: CheckResult[] = []
    // 记录签到前的余额，用来算“本次签到涨了多少”
    const before = balancesRef.current
    try {
      const final = await runAll(
        accounts,
        settings,
        (message: string) => console.log(message),
        (result: CheckResult, done: number, total: number) => {
          collected.push(result)
          setResults([...collected])
          applyResultBalance(result, before)
          setProgress(`进行中：${done}/${total}`)
        }
      )
      setResults(final)
      setLastRun(formatTime())
      const failed = final.filter(r => r.status === "fail").length
      setProgress(
        `完成：成功 ${final.length - failed} / ${final.length}` +
          (failed > 0 ? `，失败 ${failed}` : "")
      )
      // 计算本次签到总新增收益
      let totalGain = 0
      for (const res of final) {
        const prev = before[res.id]?.quota
        if (res.quota !== null && prev !== null && prev !== undefined && res.quota > prev) {
          totalGain += (res.quota - prev) / perUnit
        }
      }
      recordHistory(final, totalGain)
      setHistory(loadHistory())
      if (settings.notify && final.length > 0) {
        const notice = buildNotification(final)
        await Notification.schedule({
          title: notice.title,
          body: notice.body,
          threadIdentifier: "agentrouter",
        })
      }
    } catch (e) {
      setProgress(`运行异常：${String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="AgentRouter"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: <Button title="完成" action={dismiss} />,
          topBarTrailing: [
            <Button
              title="账号"
              systemImage="person.crop.circle"
              action={openAccounts}
            />,
            <Button
              title={running ? "签到中…" : "签到"}
              action={start}
              disabled={running || accounts.length === 0}
            />,
          ],
        }}
      >
        <Section title="账户余额">
          {accounts.length === 0 ? (
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              还没有账号，点右上角「账号」添加。
            </Text>
          ) : (
            accounts.map(account => (
              <BalanceRow
                key={account.id}
                account={account}
                balance={balances[account.id]}
                perUnit={perUnit}
                onRefresh={() => void refreshOne(account)}
                onCheckin={() => void checkinOne(account)}
                gain={gains[account.id]}
              />
            ))
          )}
          {accounts.length > 0 ? (
            <Button
              title={refreshing ? "正在刷新…" : "刷新余额"}
              systemImage="arrow.clockwise"
              action={() => void refreshAll(false)}
              disabled={refreshing}
            />
          ) : null}
          {balanceNote ? (
            <Text font="footnote" foregroundStyle="tertiaryLabel">
              {balanceNote}
            </Text>
          ) : null}
        </Section>
        <Section title="签到">
          <Button
            title={running ? "签到中…" : "立即签到"}
            systemImage="checkmark.seal.fill"
            action={start}
            disabled={running || accounts.length === 0}
          />
          {running ? (
            <HStack spacing={10}>
              <ProgressView />
              <Text font="subheadline" foregroundStyle="secondaryLabel">
                {progress || "正在签到…"}
              </Text>
            </HStack>
          ) : progress ? (
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {progress}
            </Text>
          ) : null}
          {lastRun ? (
            <Text font="footnote" foregroundStyle="tertiaryLabel">
              上次运行：{lastRun}
            </Text>
          ) : null}
        </Section>

        {results.length > 0 ? (
          <Section title="最近结果">
            {results.map(result => (
              <ResultRow key={result.id + result.time} result={result} perUnit={perUnit} />
            ))}
          </Section>
        ) : null}

        {history.length > 0 ? (
          <Section title="签到历史">
            {history.slice(0, 5).map(item => (
              <HStack key={item.id} spacing={8} alignment="center">
                <Image
                  systemName={item.failCount === 0 ? "checkmark.circle.fill" : "exclamationmark.circle.fill"}
                  foregroundStyle={item.failCount === 0 ? "systemGreen" : "systemOrange"}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text font="subheadline">{item.summary}</Text>
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    {item.time}
                  </Text>
                </VStack>
              </HStack>
            ))}
            <Button
              title="清空历史记录"
              role="destructive"
              action={() => {
                clearHistory()
                setHistory([])
              }}
            />
          </Section>
        ) : null}

        <Section title="说明">
          <Text font="footnote" foregroundStyle="secondaryLabel">
            签到 = 每天完成一次登录。脚本向 /api/user/login 提交邮箱与密码，登录响应中
            checked_in 为真即签到成功；随后再读取一次个人日志 (/api/log/self) 做端到端核验，
            确认日志里确有「签到成功」记录。
          </Text>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            余额来自 GET /api/user/self，用的是签到登录时保存的会话（不再重复调用登录接口，
            避免请求太频被限流）；换算单位取 GET /api/status 的 quota_per_unit
            （本站 500000 quota = $1，签到一次即 +$25）。
            每天首次进入本页自动刷新一次，其余时间点按账号行或「刷新余额」手动更新。
          </Text>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            想每天自动签到：在「快捷指令」里创建个人自动化（如每天 9:00）运行本脚本，
            或在运行 URL 后加 ?auto=1 静默执行并直接发通知。
          </Text>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            备用域名：https://ps.air-outer.com（功能一致，可在右上角设置里切换）。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

/**
 * 主界面上的余额行。
 * 左：账号名/邮箱；右：余额与已用额度；点按整行可单独刷新该账号。
 */
export function BalanceRow(props: {
  account: Account
  balance?: Balance
  perUnit: number
  /** 本次签到新增加的额度（quota） */
  gain?: number
  onRefresh: () => void
  onCheckin?: () => void
}) {
  const b = props.balance
  const hasBalance = !!b && b.ok && b.quota !== null
  return (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={10} alignment="center">
        <HStack
          spacing={10}
          alignment="center"
          frame={{ maxWidth: "infinity", alignment: "leading" }}
          contentShape={{ kind: "interaction", shape: "rect" }}
          onTapGesture={props.onRefresh}
        >
          <Image
            systemName="person.crop.circle.fill"
            foregroundStyle={hasBalance ? "systemBlue" : "tertiaryLabel"}
          />
          <VStack alignment="leading" spacing={2}>
            <Text font="headline">{props.account.name}</Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {props.account.email}
            </Text>
          </VStack>
        </HStack>
        <HStack spacing={8} alignment="center">
          <VStack
            alignment="trailing"
            spacing={2}
            contentShape={{ kind: "interaction", shape: "rect" }}
            onTapGesture={props.onRefresh}
          >
            <Text font="headline" foregroundStyle={hasBalance ? "systemGreen" : "secondaryLabel"}>
              {b ? formatUsd(b.quota, props.perUnit) : "未读取"}
            </Text>
            <Text font="caption" foregroundStyle="tertiaryLabel">
              {b && b.usedQuota !== null
                ? `已用 ${formatUsd(b.usedQuota, props.perUnit)}` +
                  (b.requestCount !== null ? ` · ${b.requestCount} 次` : "")
                : "点按刷新余额"}
            </Text>
            {props.gain && props.gain > 0 ? (
              <Text font="caption" foregroundStyle="systemGreen">
                本次 +{formatUsd(props.gain, props.perUnit)}
              </Text>
            ) : null}
          </VStack>
          {props.onCheckin ? (
            <HStack
              alignment="center"
              padding={{ vertical: 5, horizontal: 9 }}
              background={{ style: "#30D15822", shape: { type: "rect", cornerRadius: 8 } }}
              contentShape={{ kind: "interaction", shape: "rect" }}
              onTapGesture={props.onCheckin}
            >
              <Text font={12} bold foregroundStyle="systemGreen">
                签到
              </Text>
            </HStack>
          ) : null}
        </HStack>
      </HStack>
      {b && b.needLogin ? (
        <Text font="caption" foregroundStyle="systemOrange">
          需要重新签到登录后才能刷新余额
        </Text>
      ) : null}
      {b && b.error && !b.needLogin ? (
        <Text font="caption" foregroundStyle="systemOrange">
          {b.error}
        </Text>
      ) : null}
      {b && b.userStatus !== null && b.userStatus !== 1 ? (
        <Text font="caption" foregroundStyle="systemRed">
          账号状态：{userStatusLabel(b.userStatus)}
        </Text>
      ) : null}
    </VStack>
  )
}

type AccountsOutcome = { accounts: Account[]; settings: Settings }

/**
 * 右上角「账号」入口：账号管理（添加 / 修改 / 批量导入）与站点设置。
 * 关闭时把最新的账号与设置回传给主界面。
 */
export function AccountsView() {
  const dismissSheet = Navigation.useDismiss()
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts())
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [importText, setImportText] = useState("")
  const [note, setNote] = useState("")
  const [baseUrlText, setBaseUrlText] = useState(settings.baseUrl)
  const [timeoutText, setTimeoutText] = useState(String(settings.timeout))
  const [intervalText, setIntervalText] = useState(String(settings.interval))

  useEffect(() => {
    saveAccounts(accounts)
  }, [accounts])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const finish = () => dismissSheet({ accounts, settings } as AccountsOutcome)

  const openEditor = async (account: Account | null) => {
    const result = (await Navigation.present({
      element: <AccountEditor account={account} />,
      modalPresentationStyle: "formSheet",
    })) as EditorResult | null
    if (!result) return
    if (result.action === "save") {
      setAccounts(prev => {
        const index = prev.findIndex(a => a.id === result.account.id)
        if (index < 0) return [...prev, result.account]
        const next = [...prev]
        next[index] = result.account
        return next
      })
    } else if (result.action === "delete") {
      removeAccountSecret(result.id)
      setAccounts(prev => prev.filter(a => a.id !== result.id))
    }
  }

  const doImport = () => {
    const outcome = parseImport(importText, accounts)
    if (outcome.accounts.length === 0) {
      setNote(
        outcome.duplicates > 0
          ? `检测到 ${outcome.duplicates} 个账号已存在，已跳过`
          : "批量导入失败：请按「邮箱#密码」或「邮箱----密码」每行一个填写"
      )
      return
    }
    setAccounts(prev => [...prev, ...outcome.accounts])
    setImportText("")
    setNote(
      `已导入 ${outcome.accounts.length} 个账号` +
        (outcome.duplicates > 0 ? `（跳过 ${outcome.duplicates} 个重复账号）` : "")
    )
  }

  return (
    <NavigationStack>
      <List
        listStyle="insetGroup"
        navigationTitle="账号与设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="完成" action={finish} />,
        }}
      >
        <Section title="账号（左滑可删除）">
          <ForEach
            count={accounts.length}
            onDelete={(indices: number[]) => {
              const idsToDelete = indices.map((i: number) => accounts[i]?.id).filter(Boolean)
              idsToDelete.forEach((id: string) => removeAccountSecret(id))
              setAccounts(prev => prev.filter((_, i) => !indices.includes(i)))
            }}
            itemBuilder={(idx: number) => {
              const account = accounts[idx]
              return (
                <HStack
                  key={account.id}
                  spacing={10}
                  onTapGesture={() => openEditor(account)}
                >
                  <Image systemName="person.crop.circle.fill" foregroundStyle="systemBlue" />
                  <VStack alignment="leading" spacing={2}>
                    <Text font="headline">{account.name}</Text>
                    <Text font="subheadline" foregroundStyle="secondaryLabel">
                      {account.email}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    font="footnote"
                    foregroundStyle="tertiaryLabel"
                  />
                </HStack>
              )
            }}
          />
          <Button
            title="添加账号"
            systemImage="plus.circle.fill"
            action={() => openEditor(null)}
          />
        </Section>

        <Section title="批量导入（支持 #、----、逗号、空格）">
          <TextField
            title="粘贴文本"
            prompt="you@example.com#你的密码"
            value={importText}
            onChanged={setImportText}
            axis="vertical"
            autocorrectionDisabled
            textInputAutocapitalization="never"
          />
          <Button
            title="导入"
            action={doImport}
            disabled={importText.trim().length === 0}
          />
          {note ? (
            <Text font="footnote" foregroundStyle="tertiaryLabel">
              {note}
            </Text>
          ) : null}
        </Section>

        <Section title="设置">
          <LabeledField
            label="站点地址"
            placeholder="https://agentrouter.org"
            labelWidth={76}
            value={baseUrlText}
            onChanged={value => {
              setBaseUrlText(value)
              setSettings(prev => ({
                ...prev,
                baseUrl: value.trim() || DEFAULT_SETTINGS.baseUrl,
              }))
            }}
            keyboardType="URL"
          />
          <LabeledField
            label="超时"
            value={timeoutText}
            onChanged={value => {
              setTimeoutText(value)
              const n = Number(value)
              setSettings(prev => ({
                ...prev,
                timeout: Number.isFinite(n) && n > 0 ? n : DEFAULT_SETTINGS.timeout,
              }))
            }}
            keyboardType="numberPad"
          />
          <LabeledField
            label="账号间隔"
            value={intervalText}
            onChanged={value => {
              setIntervalText(value)
              const n = Number(value)
              setSettings(prev => ({
                ...prev,
                interval: Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTINGS.interval,
              }))
            }}
            keyboardType="numberPad"
          />
          <Toggle
            title="完成后发送通知"
            value={settings.notify}
            onChanged={value => setSettings(prev => ({ ...prev, notify: value }))}
          />
        </Section>

        <Section title="关于余额">
          <Text font="footnote" foregroundStyle="secondaryLabel">
            quota 换算成美元用的是站点 /api/status 里的 quota_per_unit（本站 500000，
            即 500000 quota = $1；签到一次 +$25 对应 12,500,000 quota）。
            当前兜底单位：{DEFAULT_QUOTA_PER_UNIT}。
          </Text>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            账号密码只保存在本机钥匙串（Keychain），不会上传到任何服务器。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}
