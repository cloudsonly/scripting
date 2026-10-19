// ===== 更新说明检查（脚本管理工具注入，勿删） =====
;(async () => {
  try {
    // 这段块永远是被发布脚本 index.tsx 的第一条语句，因此**绝对不能引用目标脚本自己
    // import 进来的名字**。加壳工具会把整个脚本打包成 CommonJS bundle（模块体被包进一个
    // 函数，require("scripting") 产生的 const 绑定虽然在本块之前声明不了、但一定在本块
    // 之后才初始化），于是：
    //   - 目标脚本没 import Script 时 → 裸的 Script 直接 ReferenceError；
    //   - 目标脚本 import 了 Script 时 → TS 会改写成 scripting_N.Script.env，
    //     而那个 const 在本块之后才初始化，处在 TDZ，同样 ReferenceError。
    // 两种都正好被本块自己的 catch 吞掉，表现就是「加壳脚本永远不弹更新说明」，
    // 而未加壳脚本因为 ESM 会把 import 提升，反而一直正常（所以这个 bug 只在加壳包上出现）。
    // 这里统一用自己的局部变量：取不到就当没取到，继续往下走，不影响脚本本体。
    // ⚠️ scripting 必须在 try **外面**用 let 声明：它下面的 try 还要拿 __S 取 Script.directory，
    // 用块内的 const 声明时那个绑定出了 try 就不可见，参考会直接抛 ReferenceError
    // （又被本块最外层的 catch 吞掉 → 更新说明永远不弹）。
    let __S: any = null
    let __env = ""
    try {
      __S = await import("scripting")
      __env = String((__S && __S.Script && __S.Script.env) || "")
    } catch (e) {}
    // 主页标签（home_screen）会反复重建实例，每次重建都会重跑这段注入块；
    // 更新说明弹窗在主页标签里既弹不出来也没意义，直接跳过省掉那几次文件读写。
    if (__env === "home_screen") return
    // 说明正文优先从脚本目录的 changelog.json 读（发布时才需要写入）：
    // 入口里的常量只是老包兜底。加壳只加密 lib/，根目录的 changelog.json 是明文文件，
    // 壳里的解密壳运行时也能读到它 —— 所以「已加壳的脚本发布新说明」不必先去壳。
    const __noteFile = "changelog.json"
    // 历史更新说明的唯一来源就是下面这个文件里的 history：随包分发、换设备/重装也都在。
    // 设备本地那份 changelog_history/{scriptName}.json 已在发布时被吸收进本文件并删除，
    // 这里不再读写它 —— 历史散在两个地方必然会出现「同一条说明只在一处能看到」。
    // 本地只留一份很小的「哪些次发布已经弹过」记录（changelog_ran），它不含说明正文。
    const __historyFromFileOnly = true
    let note = ""
    let version = "2.8.20"
    let scriptName = "EmbyLibraryKit"
    let folderName = "EmbyLibraryKit"
    let scriptAuthor = "cloudsonly"
    let notifyAuthor = false
    let publishId = "p1792151833921-62783"
    // 历史更新说明：**只**从包里 changelog.json 的 history 读（随包分发，换设备/重装也有）。
    // 设备本地那份 changelog_history/{scriptName}.json 已在发布时被吸收进本文件并删除，
    // 运行期不再读写它（否则历史会散在两个地方，同一条说明只在一处能看到）。
    // 本地只留一份很小的「哪几次发布已经弹过」记录 changelog_ran/{scriptName}.json，
    // 只存 版本号@发布序号 字符串，不含说明正文。
    let fileHistory: { version: string; note: string }[] = []
    let ranPath = ""
    let ran: Record<string, number> = {}
    try {
      const __dir = String((__S && __S.Script && __S.Script.directory) || "")
      if (__dir) {
        const __p = __dir + "/" + __noteFile
        if (FileManager.existsSync(__p)) {
          const __f = JSON.parse(await FileManager.readAsString(__p)) || {}
          if (typeof __f.note === "string" && __f.note.trim()) {
            note = __f.note
            version = String(__f.version || version || "")
            scriptName = String(__f.scriptName || scriptName || "")
            folderName = String(__f.folderName || folderName || "")
            scriptAuthor = String(__f.scriptAuthor || scriptAuthor || "")
            if (typeof __f.notifyAuthor === "boolean") notifyAuthor = __f.notifyAuthor
            if (typeof __f.publishId === "string" && __f.publishId) publishId = __f.publishId
            if (Array.isArray(__f.history)) {
              fileHistory = __f.history.filter((h: any) => h && typeof h === "object" && typeof h.version === "string" && typeof h.note === "string" && h.version && h.note)
            }
          }
        }
      }
    } catch (e) {}
    if (!note) return
    if (!version) return
    const base = FileManager.appGroupDocumentsDirectory || ""
    // base 拿不到时（脚本无 App Group 权限等）不能直接 return，否则更新说明永远不弹：
    // 只是无法写去重记录，这时跳过读写继续往下弹
    let history: { version: string; note: string }[] = []
    let skipPrompt = false
    let seen: Record<string, boolean> = {}
    let statePath = ""
    let hideButtonLabels = false
    let langIsEn = false
    const verNums = (v: string) => {
      const p = String(v || "").split(".").map((n) => parseInt(n, 10) || 0)
      while (p.length < 3) p.push(0)
      return p
    }
    // 「本次发布之前是不是已经在这个设备上弹过」：只看本地那份 ran 记录（只存发布键）。
    // 不能拿包里 history 判 —— 那一堆本来就有本次发布的条目，拿它判会永不弹窗。
    // 去重键只用「版本号@发布序号」：版本号一致但重新发布（换了说明）时仍会重新提示。
    const seenKey = version + "@" + publishId
    if (base) {
      ranPath = base + "/changelog_ran/" + scriptName + ".json"
      try {
        try { await FileManager.createDirectory(base + "/changelog_ran", true) } catch (e) {}
        const raw = JSON.parse(await FileManager.readAsString(ranPath))
        if (raw && typeof raw === "object") ran = raw
      } catch (e) {}
      if (Number(ran[seenKey] || 0) > 0) skipPrompt = true
    }
    // 展示用的历史 = 包里 changelog.json 的 history（即写入时已经算好的完整列表）。
    // 只做「同文合并 + 排序」这两种**纯展示层**的整理，不写回任何文件：
    // 说明正文的唯一落盘位置是 changelog.json（发布时写的），运行期只读。
    try {
      const byNote = new Map<string, { version: string, note: string }>()
      for (const h of fileHistory) {
        if (!h) continue
        const key = String(h.note || "")
        const prev = byNote.get(key)
        if (!prev) {
          byNote.set(key, { version: h.version, note: h.note })
          continue
        }
        const a = verNums(h.version)
        const b = verNums(prev.version)
        let bigger = false
        for (let i = 0; i < 3; i++) {
          if (a[i] !== b[i]) {
            bigger = a[i] > b[i]
            break
          }
        }
        if (bigger) byNote.set(key, { version: h.version, note: h.note })
      }
      history = Array.from(byNote.values())
    } catch (e) {}
    try {
      // 本次条目已经在包里 history 里：去掉旧条目再把本次置顶（页面默认停在第 1 页）
      history = history.filter((h) => h && h.version !== version && h.note !== note)
      history.sort((a, b) => {
        const pa = verNums(a.version)
        const pb = verNums(b.version)
        for (let i = 0; i < 3; i++) {
          if (pa[i] !== pb[i]) return pb[i] - pa[i]
        }
        return 0
      })
      // 本次发布的说明恒定排在第 1 页，其余历史按版本号降序跟在其后（最多共 20 条）：
      // 弹窗默认停在第 1 页，用户必须先翻页才能看到「这次的更新写了什么」是错的；
      // 而且版本号一旦回退（重置版本号、测试版改名回写、从高版本分支切回来，
      // 例如 1.0.111 → 1.0.3），仅按版本号排序会把本次说明压到最后一页甚至被截断丢弃，
      // 所以本次条目不参与排序，强制置顶
      history = [{ version, note }].concat(history.slice(0, 19))
    } catch (e) {}
    if (base) {
      const seenDir = base + "/changelog_seen"
      try { await FileManager.createDirectory(seenDir, true) } catch (e) {}
      statePath = seenDir + "/" + scriptName + ".json"
      try { seen = JSON.parse(await FileManager.readAsString(statePath)) || {} } catch (e) {}
      // 作者本人不提示：本机脚本管理工具发布过该版本（本机即作者/发布者设备），或设置里填写的用户名与脚本作者一致，
      // 且本次发布未勾选「作者本人也提示更新」时，不弹更新说明
      try {
        const mgrCfgPath = base + "/script-manager-config.json"
        const mgrCfg = JSON.parse(await FileManager.readAsString(mgrCfgPath)) || {}
        hideButtonLabels = mgrCfg.hideButtonLabels === true
        // 兜底：读取不到系统语言（兼容旧版 Scripting/特殊环境）时，回退「用户设置」里的中英文切换
        langIsEn = mgrCfg.language === "en"
        const mgrName = String(mgrCfg.authorName || "").trim()
        const published = mgrCfg.publishedVersions || {}
        if (!notifyAuthor && ((scriptAuthor && mgrName && mgrName === scriptAuthor) || published[folderName] === version)) {
          return
        }
      } catch (e) {}
    }
    // 本次发布之前已经在这个设备上弹过（ran 记录里有）：不再提示，避免把同一次发布重复弹一遍
    if (skipPrompt) return
    // 用户点过「不提醒」的那几次发布：不再提示
    if (seen[seenKey]) return
    // 同一次发布短时间内只提示一次：同一份代码可能被并发执行两份
    // （常驻主页标签 import 本入口时顶层代码会跟着跑一遍、用户连点图标、
    //  快捷指令与点击同时启动），两个实例都会通过上面的 seen 检查、各弹一个窗。
    // seen 只在用户点「不提醒」时写，挡不住这种情况，这里用单独的「已提示」记录占位，
    // 且必须赶在下面的 600ms 延时之前写入：后到的实例醒来看到记录就直接退出。
    // 同一个文件里再记一条**永久**的 ran：本次发布已经在这个设备上弹过，以后都不再弹。
    // 它取代了原先「设备本地历史里有没有本次条目」那个判据（那个文件已被 changelog.json 取代）。
    const shownPath = base ? base + "/changelog_shown/" + scriptName + ".json" : ""
    if (shownPath) {
      const shownTtl = 10 * 60 * 1000
      let shown: Record<string, number> = {}
      try { shown = JSON.parse(await FileManager.readAsString(shownPath)) || {} } catch (e) {}
      const lastShown = Number(shown[seenKey] || 0)
      if (lastShown > 0 && Date.now() - lastShown < shownTtl) return
      try {
        try { await FileManager.createDirectory(base + "/changelog_shown", true) } catch (e) {}
        shown[seenKey] = Date.now()
        // 只保留最近 10 条，避免文件无限增长
        const shownKeys = Object.keys(shown)
        if (shownKeys.length > 10) {
          shownKeys.sort((a, b) => Number(shown[b]) - Number(shown[a]))
          for (const k of shownKeys.slice(10)) delete shown[k]
        }
        await FileManager.writeAsString(shownPath, JSON.stringify(shown))
      } catch (e) {}
    }
    if (ranPath) {
      try {
        ran[seenKey] = Date.now()
        // 只保留最近 20 次发布，避免文件无限增长
        const ranKeys = Object.keys(ran)
        if (ranKeys.length > 20) {
          ranKeys.sort((a, b) => Number(ran[b]) - Number(ran[a]))
          for (const k of ranKeys.slice(20)) delete ran[k]
        }
        await FileManager.writeAsString(ranPath, JSON.stringify(ran))
      } catch (e) {}
    }
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 600))
    const { Navigation, NavigationStack, ScrollView, VStack, HStack, Text, Button, Divider, Spacer, Image, ZStack, useState, useEffect, Device } = await import("scripting")
    // 更新说明页面文案语言优先跟随「系统语言」：非中文系统按英文显示（只有中英两版，其他语言回退英文），
    // 拿不到系统语言时保持上面读到的用户设置兜底值
    try {
      const sysLang = String((Device && (Device.systemLanguageCode || (Device.preferredLanguages && Device.preferredLanguages[0]))) || "").trim()
      if (sysLang) {
        langIsEn = !/^zh/i.test(sysLang)
      }
    } catch (e) {}
    const markSeen = async () => {
      if (!statePath) return
      try {
        seen[seenKey] = true
        await FileManager.writeAsString(statePath, JSON.stringify(seen))
      } catch (e) {}
    }
    function ChangelogView(props: { note: string; version: string; scriptName: string; history: { version: string; note: string }[] }) {
      const dismiss = Navigation.useDismiss()
      // 文案语言：优先系统语言（非中文系统显示英文），读取失败回退用户设置；英文显示英文，否则中文
      const isEn = langIsEn
      const noHistoryText = isEn ? "No update history" : "暂无历史更新记录"
      const versionPrefix = isEn ? "Version " : "版本 "
      const pageText = (i: number, t: number) => (isEn ? i + " / " + t : "第 " + i + " / " + t + " 页")
      const labelFirst = isEn ? "First" : "首页"
      const labelPrev = isEn ? "Prev" : "上页"
      const labelNext = isEn ? "Next" : "下页"
      const labelLast = isEn ? "Last" : "尾页"
      const labelNoRemind = isEn ? "No remind" : "不提醒"
      const labelDismiss = isEn ? "Close" : "临时关"
      const [pageIndex, setPageIndex] = useState(0)
      const [scrollAnchor, setScrollAnchor] = useState<string | null>("note")
      // 检测内容是否不满一页：首次可见性回调时若底部 Divider（changelog-end）无需滚动即可见，则为不满一页；
      // 不满一页时不显示内容末尾的灰色实线与右下角向下图标（null=尚未检测到，保持原行为，兼容 iOS 17 降级）
      const [endInitiallyVisible, setEndInitiallyVisible] = useState<boolean | null>(null)
      const atBottom = scrollAnchor === "changelog-end"
      const shortContent = endInitiallyVisible === true
      // 翻页后内容变化，重置检测让可见性回调重新判断当前页
      useEffect(() => {
        setEndInitiallyVisible(null)
      }, [pageIndex])
      const total = props.history.length
      const current = total > 0 ? props.history[Math.min(pageIndex, total - 1)] : null
      const atFirst = pageIndex <= 0
      const atLast = pageIndex >= total - 1
      // 英文模式下：发布方写的更新说明若含中文，先走免费网络翻译（免费/非 Pro 用户也能用），
      // 网络失败/离线再回退 Apple 机内翻译；都失败/不可用则显示原文。
      const hasCJK = (s: string): boolean => {
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i)
          if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) return true
        }
        return false
      }
      const txTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((res, rej) => {
        const t = setTimeout(() => rej(new Error("timeout")), ms)
        p.then((v: T) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) })
      })
      // 免费网络翻译兜底（谷歌：Chrome 词典端点更抗限流，优先；失败再走 gtx；无需密钥、不挑 Pro/iOS18/语言包）
      const translateNetwork = (text: string, ms: number): Promise<string> => {
        const dictUrl = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=en&q=" + encodeURIComponent(text)
        const gtxUrl = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" + encodeURIComponent(text)
        const pick = (url: string) => txTimeout(fetch(url), ms).then(async (res) => {
          if (!res.ok) throw new Error("HTTP " + res.status)
          const data: any = await res.json()
          if (Array.isArray(data) && typeof data[0] === "string") return data[0]
          const segs: any[] = Array.isArray(data?.[0]) ? data[0] : []
          let out = ""
          for (const s of segs) { if (Array.isArray(s) && typeof s[0] === "string") out += s[0] }
          return out
        })
        return pick(dictUrl).catch(() => pick(gtxUrl))
      }
      // 中→英：网络优先，失败回退 Apple 机内翻译
      const translateNote = (text: string): Promise<string> => (async () => {
        try {
          const r = await translateNetwork(text, 6000)
          if (r && r.trim()) return r.trim()
        } catch (e) {}
        try {
          const raw: any = await txTimeout(Translation.shared.translate({ text, source: "zh", target: "en" }) as any, 4000)
          const r = typeof raw === "string" ? raw : ""
          return r && r.trim() ? r.trim() : text
        } catch (e) { return text }
      })()
      const [translations, setTranslations] = useState<Record<string, string>>({})
      useEffect(() => {
        if (!isEn || !current) return
        const n = current.note
        if (translations[n] != null) return
        if (!hasCJK(n)) { setTranslations((p) => ({ ...p, [n]: n })); return }
        let alive = true
        translateNote(n)
          .then((out: string) => { if (alive) setTranslations((p) => ({ ...p, [n]: out && out.trim() ? out.trim() : n })) })
          .catch(() => { if (alive) setTranslations((p) => ({ ...p, [n]: n })) })
        return () => { alive = false }
      }, [isEn, current])
      const displayNote = current ? (translations[current.note] != null ? translations[current.note] : current.note) : ""
      // 底部按钮列宽与标签：英文文案（如「No remind」）比中文长，原先 36 的标签宽度会把英文文字
      // 截断成「No remi…」（英文版本下按钮文字显示不全），因此列宽放宽到 48，并允许标签按需缩放，
      // 保证中英文标签都完整显示；图标仍为 36×36 圆形，列内居中，视觉不变
      const buttonColumnWidth = 48
      const buttonLabel = (label: string) => (
        <Text font={9} foregroundStyle="secondaryLabel" lineLimit={1} minScaleFactor={0.6} allowsTightening frame={{ maxWidth: buttonColumnWidth }}>{label}</Text>
      )
      const navButton = (icon: string, color: any, disabled: boolean, action: () => void, label: string) => (
        <VStack alignment="center" spacing={2} frame={{ width: buttonColumnWidth }}>
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
          {!hideButtonLabels && buttonLabel(label)}
        </VStack>
      )
      // 底部操作按钮（图标 + 可选文字标签）：hideButtonLabels 开启（隐藏）时只显示纯圆形图标
      const actionButton = (icon: string, color: any, label: string, action: () => void) => (
        <VStack alignment="center" spacing={2} frame={{ width: buttonColumnWidth }}>
          <ZStack
            frame={{ width: 36, height: 36 }}
            background={{ style: { color, opacity: 0.15 }, shape: { type: "rect", cornerRadius: 18 } }}
            contentShape={{ kind: "interaction", shape: "rect" }}
            onTapGesture={action}
          >
            <Image systemName={icon} font={14} foregroundStyle={color} />
          </ZStack>
          {!hideButtonLabels && buttonLabel(label)}
        </VStack>
      )
      return (
        <NavigationStack translationHost={Translation.shared}>
          <VStack navigationTitle={props.scriptName + (isEn ? " · Changelog" : " · 更新说明")} navigationBarTitleDisplayMode="inline" navigationBarBackButtonHidden spacing={0}>
            {total === 0 ? (
              <VStack alignment="center" spacing={8} padding={32} frame={{ maxHeight: "infinity" }}>
                <Text font="subheadline" foregroundStyle="secondaryLabel">{noHistoryText}</Text>
              </VStack>
            ) : current ? (
              <>
                <HStack alignment="center" padding={{ top: 14, horizontal: 16, bottom: 10 }}>
                  <Text font="headline" bold>{versionPrefix}{current.version}</Text>
                  <Spacer />
                  <Text font="caption2" foregroundStyle="secondaryLabel">{pageText(pageIndex + 1, total)}</Text>
                </HStack>
                <ZStack alignment="bottomTrailing" frame={{ maxHeight: "infinity" }}>
                  <ScrollView
                    frame={{ maxHeight: "infinity" }}
                    scrollIndicator="visible"
                    scrollPosition={{ value: scrollAnchor, onChanged: (v) => setScrollAnchor(v as string | null), anchor: "bottom" }}
                    onScrollTargetVisibilityChange={{
                      idType: "string",
                      threshold: 0,
                      onChanged: (ids) => {
                        // 首次回调确定底部 Divider 是否初始可见：可见 ⇒ 内容不满一页
                        setEndInitiallyVisible((prev) =>
                          prev === null ? (Array.isArray(ids) && (ids as string[]).includes("changelog-end")) : prev
                        )
                      },
                    }}
                  >
                    <VStack scrollTargetLayout alignment="leading" spacing={10} padding={{ horizontal: 16, bottom: 24 }}>
                      <VStack key="note" alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        <Text font="body" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{displayNote}</Text>
                      </VStack>
                      {!shortContent && <Divider key="changelog-end" />}
                    </VStack>
                  </ScrollView>
                  {!shortContent && !atBottom && (
                    <VStack padding={{ horizontal: 12, vertical: 10 }}>
                      <Image systemName="arrow.down.circle" font={15} foregroundStyle="systemBlue" />
                    </VStack>
                  )}
                </ZStack>
              </>
            ) : null}
            <VStack spacing={2} alignment="center" padding={{ horizontal: 16, vertical: 12 }} background={{ style: "barMaterial", shape: { type: "rect", cornerRadius: 16 } }} shadow={{ radius: 8, y: 2, color: "#00000014" }}>
              <HStack spacing={8} alignment="center" padding={{ horizontal: 10, vertical: 8 }}>
                {navButton("backward.end.fill", "systemBlue", atFirst, () => setPageIndex(0), labelFirst)}
                {navButton("chevron.left", "systemBlue", atFirst, () => setPageIndex(pageIndex - 1), labelPrev)}
                {navButton("chevron.right", "systemBlue", atLast, () => setPageIndex(pageIndex + 1), labelNext)}
                {navButton("forward.end.fill", "systemBlue", atLast, () => setPageIndex(total - 1), labelLast)}
              </HStack>
              <HStack spacing={8} alignment="center">
                {actionButton("bell.slash", "systemRed", labelNoRemind, () => { markSeen(); dismiss() })}
                {actionButton("xmark", "label", labelDismiss, () => dismiss())}
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
import RootView from "./src/ui/RootView"

export default RootView

async function run() {
  try {
    await Navigation.present({
      element: <RootView />,
      modalPresentationStyle: "overFullScreen",
    })
  } finally {
    Script.exit()
  }
}

run()
