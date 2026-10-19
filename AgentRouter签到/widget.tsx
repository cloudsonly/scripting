// AgentRouter 桌面小组件
// 支持 systemSmall 和 systemMedium，展示总额度、各账号余额及今日签到状态
import {
  VStack,
  HStack,
  ZStack,
  Text,
  Image,
  Spacer,
  Widget,
} from "scripting"
import {
  loadAccounts,
  loadBalances,
  loadSettings,
  loadPerUnit,
  formatUsd,
  loadLastRun,
  refreshedBalancesToday,
} from "./agentrouter"

// 品牌与状态色彩
const COLOR_BG = "#0B1528"
const COLOR_CARD = "#14233D"
const COLOR_BLUE = "#0A84FF"
const COLOR_GREEN = "#30D158"
const COLOR_MUTED = "#8E8E93"
const COLOR_WHITE = "#FFFFFF"

function SmallWidget() {
  const accounts = loadAccounts()
  const balances = loadBalances()
  const settings = loadSettings()
  const perUnit = loadPerUnit(settings)
  const isCheckedIn = refreshedBalancesToday()
  const lastRun = loadLastRun()

  let totalQuota = 0
  let validCount = 0
  for (const a of accounts) {
    const b = balances[a.id]
    if (b && b.quota !== null) {
      totalQuota += b.quota
      validCount++
    }
  }

  const totalUsdText = validCount > 0 ? formatUsd(totalQuota, perUnit) : "--"

  return (
    <ZStack background={COLOR_BG}>
      <VStack
        alignment="leading"
        spacing={6}
        padding={14}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      >
        <HStack alignment="center" spacing={6}>
          <Image systemName="bolt.shield.fill" font={13} foregroundStyle={COLOR_BLUE} />
          <Text font={12} bold foregroundStyle={COLOR_WHITE}>
            AgentRouter
          </Text>
          <Spacer />
          <Text
            font={10}
            bold
            foregroundStyle={isCheckedIn ? COLOR_GREEN : COLOR_MUTED}
          >
            {isCheckedIn ? "已打卡" : "待签到"}
          </Text>
        </HStack>

        <Spacer />

        <VStack alignment="leading" spacing={2}>
          <Text font={10} foregroundStyle={COLOR_MUTED}>
            总可用额度 ({accounts.length} 账号)
          </Text>
          <Text font={22} bold foregroundStyle={COLOR_GREEN} lineLimit={1} allowsTightening>
            {totalUsdText}
          </Text>
        </VStack>

        <Spacer />

        <HStack alignment="center">
          <Text font={9} foregroundStyle={COLOR_MUTED} lineLimit={1}>
            {lastRun ? `更新于 ${lastRun.slice(5, 16)}` : "未运行"}
          </Text>
        </HStack>
      </VStack>
    </ZStack>
  )
}

function MediumWidget() {
  const accounts = loadAccounts()
  const balances = loadBalances()
  const settings = loadSettings()
  const perUnit = loadPerUnit(settings)
  const isCheckedIn = refreshedBalancesToday()
  const lastRun = loadLastRun()

  let totalQuota = 0
  for (const a of accounts) {
    const b = balances[a.id]
    if (b && b.quota !== null) {
      totalQuota += b.quota
    }
  }

  const displayAccounts = accounts.slice(0, 3)

  return (
    <ZStack background={COLOR_BG}>
      <VStack
        alignment="leading"
        spacing={8}
        padding={14}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      >
        {/* 顶部标题栏 */}
        <HStack alignment="center" spacing={6}>
          <Image systemName="bolt.shield.fill" font={14} foregroundStyle={COLOR_BLUE} />
          <Text font={13} bold foregroundStyle={COLOR_WHITE}>
            AgentRouter 资产看板
          </Text>
          <Spacer />
          <HStack spacing={4} alignment="center">
            <Image
              systemName={isCheckedIn ? "checkmark.circle.fill" : "clock.fill"}
              font={10}
              foregroundStyle={isCheckedIn ? COLOR_GREEN : COLOR_MUTED}
            />
            <Text
              font={11}
              bold
              foregroundStyle={isCheckedIn ? COLOR_GREEN : COLOR_MUTED}
            >
              {isCheckedIn ? "今日已签到" : "今日待签到"}
            </Text>
          </HStack>
        </HStack>

        {/* 中部汇总与账号明细 */}
        <HStack spacing={12} alignment="center">
          {/* 左侧总资产 */}
          <VStack
            alignment="leading"
            spacing={3}
            padding={{ vertical: 10, horizontal: 12 }}
            background={COLOR_CARD}
            frame={{ width: 120 }}
          >
            <Text font={10} foregroundStyle={COLOR_MUTED}>
              总剩余额度
            </Text>
            <Text font={18} bold foregroundStyle={COLOR_GREEN} lineLimit={1} allowsTightening>
              {formatUsd(totalQuota, perUnit)}
            </Text>
            <Text font={9} foregroundStyle={COLOR_MUTED}>
              {accounts.length} 个账号配置
            </Text>
          </VStack>

          {/* 右侧账号列表 */}
          <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity" }}>
            {displayAccounts.length === 0 ? (
              <Text font={11} foregroundStyle={COLOR_MUTED}>
                暂无账号，请在 App 中添加
              </Text>
            ) : (
              displayAccounts.map(a => {
                const b = balances[a.id]
                const quotaText = b && b.quota !== null ? formatUsd(b.quota, perUnit) : "未读取"
                return (
                  <HStack key={a.id} alignment="center" spacing={4}>
                    <Text font={11} bold foregroundStyle={COLOR_WHITE} lineLimit={1} frame={{ maxWidth: 85 }}>
                      {a.name}
                    </Text>
                    <Spacer />
                    <Text font={11} foregroundStyle={COLOR_GREEN} bold>
                      {quotaText}
                    </Text>
                  </HStack>
                )
              })
            )}
            {accounts.length > 3 ? (
              <Text font={9} foregroundStyle={COLOR_MUTED}>
                等共 {accounts.length} 个账号
              </Text>
            ) : null}
          </VStack>
        </HStack>

        <Spacer />

        {/* 底部运行时间 */}
        <HStack alignment="center">
          <Text font={9} foregroundStyle={COLOR_MUTED}>
            {lastRun ? `上次运行: ${lastRun}` : "尚未执行签到"}
          </Text>
        </HStack>
      </VStack>
    </ZStack>
  )
}

function WidgetEntry() {
  const family = String(Widget.family)
  if (family === "systemMedium") {
    return <MediumWidget />
  }
  return <SmallWidget />
}

Widget.present(<WidgetEntry />)
