/**
 * 批量导入的「等用户回到本页」暂停点。
 *
 * 判定「用户回来了」用三个信号，任一满足即继续（都是为了防止卡住）：
 * 1. `requestContinue()` —— 页面里订阅了 `Script.onResume`（从别的 App 切回来 / 脚本被重新唤起）与
 *    「立即下一条」按钮，都会调用它；
 * 2. 定时器补跑时间差 —— App 被系统挂起时定时器冻结，回到前台会一次补跑一大截（≥900ms）；
 * 3. 兜底上限 `capMs`（默认 10 秒）—— 万一上面两个信号都没触发，也不会一直卡着。
 *
 * 另外有「最小停留」`MIN_DWELL_MS`：刚打开目标 App 时不会立刻被拉去下一个 App，
 * 留出在目标 App 里确认导入的时间（曾经因为判定太快被要求改成纯手动）。
 *
 * ⚠ 本模块的导出名被 BatchImportPage 直接 import。改导出名一定要同步改页面，
 * 并用临时脚本 `import * as m from "./src/foreground"` 打印 keys 验证
 * （`scripting-ts project --check` 抓不到「少了一个 export」这类问题）。
 */

const POLL_MS = 250
/** 定时器补跑超过这个时长就认为 App 被挂起过（用户离开了本页） */
const DRIFT_THRESHOLD_MS = 900
/** 打开目标 App 后至少停留这么久，避免「太快」把用户又拉走 */
const MIN_DWELL_MS = 800
/** 默认兜底上限：即使检测不到，也不会一直等 */
export const DEFAULT_WAIT_CAP_MS = 10000

let continueToken = 0

/** 用户点「立即下一条」，或脚本被重新唤起时调用 */
export function requestContinue(): void {
  continueToken++
}

/** 当前令牌（用于判断等待期间是否被点过） */
export function currentContinueToken(): number {
  return continueToken
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms))
}

/**
 * 等用户回到本页再继续下一条。
 * @param isCancelled 返回 true 表示用户点了「停止」
 * @param capMs 兜底上限（毫秒，0 表示不限时）
 * @param onWait 可选：等待开始/结束时回调（给 UI 显示提示用）
 * @returns true = 继续，false = 被取消
 */
export async function waitForReturn(
  isCancelled: () => boolean,
  capMs = DEFAULT_WAIT_CAP_MS,
  onWait?: (waiting: boolean) => void
): Promise<boolean> {
  const startToken = continueToken
  const startedAt = Date.now()
  onWait?.(true)
  try {
    while (true) {
      if (isCancelled()) return false
      if (continueToken !== startToken) return true
      const before = Date.now()
      await sleep(POLL_MS)
      const away = Date.now() - startedAt
      // 定时器被冻结过 → 补跑；且已经停留够久
      if (away >= MIN_DWELL_MS && Date.now() - before - POLL_MS >= DRIFT_THRESHOLD_MS) return true
      if (capMs > 0 && away >= capMs) return true
    }
  } finally {
    onWait?.(false)
  }
}

/** 旧名字，保留兼容：纯手动等待（点「继续」才走；capMs=0 表示不限时） */
export async function waitForContinue(isCancelled: () => boolean, capMs = 0): Promise<boolean> {
  return waitForReturn(isCancelled, capMs)
}
