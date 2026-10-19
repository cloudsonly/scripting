// ===== 更新说明检查（脚本管理工具注入，勿删） =====
;(async () => {
  try {
    const note = "v1.15.0（2026-09-20）\nEplayerX 备用线路更改格式\n解析不到服务器名称时留空\n线路名称按原文标签识别"
    if (!note) return
    const version = "1.15.0"
    const scriptName = "媒体库导入助手"
    const folderName = "媒体库导入助手"
    if (!version) return
    const scriptAuthor = "cloudsonly"
    const notifyAuthor = false
    const publishId = "p1789843202513-2404"
    const base = FileManager.appGroupDocumentsDirectory || ""
    if (!base) return
    // 记录历史更新说明（changelog_history/{scriptName}.json，按版本号降序，最多 20 条，同版本去重）
    const histDir = base + "/changelog_history"
    try { await FileManager.createDirectory(histDir, true) } catch (e) {}
    const histPath = histDir + "/" + scriptName + ".json"
    let history: { version: string; note: string }[] = []
    try {
      const raw = JSON.parse(await FileManager.readAsString(histPath))
      if (Array.isArray(raw)) history = raw
    } catch (e) {}
    try {
      history = history.filter((h) => h && h.version !== version)
      history.push({ version, note })
      const verNums = (v: string) => {
        const p = String(v || "").split(".").map((n) => parseInt(n, 10) || 0)
        while (p.length < 3) p.push(0)
        return p
      }
      history.sort((a, b) => {
        const pa = verNums(a.version)
        const pb = verNums(b.version)
        for (let i = 0; i < 3; i++) {
          if (pa[i] !== pb[i]) return pb[i] - pa[i]
        }
        return 0
      })
      history = history.slice(0, 20)
      await FileManager.writeAsString(histPath, JSON.stringify(history))
    } catch (e) {}
    const seenDir = base + "/changelog_seen"
    try { await FileManager.createDirectory(seenDir, true) } catch (e) {}
    const statePath = seenDir + "/" + scriptName + ".json"
    let seen: Record<string, boolean> = {}
    try { seen = JSON.parse(await FileManager.readAsString(statePath)) || {} } catch (e) {}
    if (seen[version]) return
    // 作者本人不提示：本机脚本管理工具发布过该版本（本机即作者/发布者设备），或设置里填写的用户名与脚本作者一致，
    // 且本次发布未勾选「作者本人也提示更新」时，不弹更新说明
    let hideButtonLabels = false
    try {
      const mgrCfgPath = base + "/script-manager-config.json"
      const mgrCfg = JSON.parse(await FileManager.readAsString(mgrCfgPath)) || {}
      hideButtonLabels = mgrCfg.hideButtonLabels === true
      const mgrName = String(mgrCfg.authorName || "").trim()
      const published = mgrCfg.publishedVersions || {}
      if (!notifyAuthor && ((scriptAuthor && mgrName && mgrName === scriptAuthor) || published[folderName] === version)) {
        return
      }
    } catch (e) {}
    // 同一发布实例只提示一次（按 版本号@发布序号 去重）：即使版本号一致，重新发布也会重新提示
    const seenKey = version + "@" + publishId
    if (seen[seenKey]) return
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 600))
    const { Navigation, NavigationStack, ScrollView, VStack, HStack, Text, Button, Divider, Spacer, Image, ZStack, useState } = await import("scripting")
    const markSeen = async () => {
      try {
        seen[seenKey] = true
        await FileManager.writeAsString(statePath, JSON.stringify(seen))
      } catch (e) {}
    }
    function ChangelogView(props: { note: string; version: string; scriptName: string; history: { version: string; note: string }[] }) {
      const dismiss = Navigation.useDismiss()
      const [pageIndex, setPageIndex] = useState(0)
      const total = props.history.length
      const current = total > 0 ? props.history[Math.min(pageIndex, total - 1)] : null
      const atFirst = pageIndex <= 0
      const atLast = pageIndex >= total - 1
      const navButton = (icon: string, color: any, disabled: boolean, action: () => void, label: string) => (
        <VStack alignment="center" spacing={2}>
          <ZStack
            frame={{ width: 36, height: 36 }}
            background={{
              style: { color: disabled ? "label" : color, opacity: disabled ? 0.08 : 0.15 },
              shape: { type: "rect", cornerRadius: 18 },
            }}
            contentShape={{ kind: "interaction", shape: "rect" }}
            onTapGesture={() => { if (!disabled) action() }}
          >
            <Image systemName={icon} font={14} foregroundStyle={disabled ? "secondaryLabel" : color} />
          </ZStack>
          {!hideButtonLabels && (
            <Text font={9} foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: 36 }} allowsTightening>{label}</Text>
          )}
        </VStack>
      )
      // 底部操作按钮（图标 + 可选文字标签）：hideButtonLabels 开启（隐藏）时只显示纯圆形图标
      const actionButton = (icon: string, color: any, label: string, action: () => void) => (
        <VStack alignment="center" spacing={2}>
          <ZStack
            frame={{ width: 36, height: 36 }}
            background={{ style: { color, opacity: 0.15 }, shape: { type: "rect", cornerRadius: 18 } }}
            contentShape={{ kind: "interaction", shape: "rect" }}
            onTapGesture={action}
          >
            <Image systemName={icon} font={14} foregroundStyle={color} />
          </ZStack>
          {!hideButtonLabels && (
            <Text font={9} foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: 36 }} allowsTightening>{label}</Text>
          )}
        </VStack>
      )
      return (
        <NavigationStack>
          <VStack navigationTitle={props.scriptName + " · 更新说明"} navigationBarTitleDisplayMode="inline" navigationBarBackButtonHidden spacing={0}>
            {total === 0 ? (
              <VStack alignment="center" spacing={8} padding={32} frame={{ maxHeight: "infinity" }}>
                <Text font="subheadline" foregroundStyle="secondaryLabel">暂无历史更新记录</Text>
              </VStack>
            ) : current ? (
              <>
                <HStack alignment="center" padding={{ top: 14, horizontal: 16, bottom: 10 }}>
                  <Text font="headline" bold>版本 {current.version}</Text>
                  <Spacer />
                  <Text font="caption2" foregroundStyle="secondaryLabel">第 {pageIndex + 1} / {total} 页</Text>
                </HStack>
                <ScrollView frame={{ maxHeight: "infinity" }}>
                  <VStack alignment="leading" spacing={10} padding={{ horizontal: 16, bottom: 16 }}>
                    <Text font="body" multilineTextAlignment="leading">{current.note}</Text>
                  </VStack>
                </ScrollView>
              </>
            ) : null}
            <VStack spacing={12} alignment="center" padding={{ horizontal: 16, vertical: 12 }} background={{ style: "barMaterial", shape: { type: "rect", cornerRadius: 16 } }} shadow={{ radius: 8, y: 2, color: "#00000014" }}>
              <HStack spacing={8} alignment="center" padding={{ horizontal: 10, vertical: 8 }}>
                {navButton("backward.end.fill", "systemBlue", atFirst, () => setPageIndex(0), "首页")}
                {navButton("chevron.left", "systemBlue", atFirst, () => setPageIndex(pageIndex - 1), "上页")}
                {navButton("chevron.right", "systemBlue", atLast, () => setPageIndex(pageIndex + 1), "下页")}
                {navButton("forward.end.fill", "systemBlue", atLast, () => setPageIndex(total - 1), "尾页")}
              </HStack>
              <HStack spacing={8} alignment="center">
                {actionButton("bell.slash", "systemRed", "此版不再显示", () => { markSeen(); dismiss() })}
                {actionButton("xmark", "label", "稍候再看说明", () => dismiss())}
              </HStack>
            </VStack>
          </VStack>
        </NavigationStack>
      )
    }
    await Navigation.present({
      element: <ChangelogView note={note} version={version} scriptName={scriptName} history={history} />,
    })
  } catch (e) {}
})();
// ===== 更新说明检查结束 =====





import { Navigation, Script } from "scripting"
import BatchImportPage from "./src/ui/BatchImportPage"

export default BatchImportPage

async function run() {
  try {
    // overFullScreen：视觉上仍然全屏，但不会把 App 自身的容器一起顶掉（用 fullScreen 关闭时会弹「没有脚本」）
    await Navigation.present({
      element: <BatchImportPage />,
      modalPresentationStyle: "overFullScreen",
    })
  } finally {
    Script.exit()
  }
}

run()
