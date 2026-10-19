/** 批量逐条打开 URL Scheme 的执行引擎（与 UI 解耦，便于单独验证）。 */

export interface BatchItem {
  /** 用于标记「已导入」的稳定 id */
  id: string
  /** 原始链接，直接交给系统打开 */
  raw: string
  /** 展示用名称 */
  label: string
}

export interface BatchOptions {
  /** 返回 true 表示用户要求停止 */
  isCancelled: () => boolean
  /** 进度回调：(已完成, 总数, 当前条目) */
  onProgress?: (done: number, total: number, current: string) => void
  /**
   * 每条之间的等待，默认不等待。
   * `opened` 表示这一条是否真的打开了目标 App（没打开时通常不必等待）。
   */
  between?: (item: BatchItem, index: number, opened: boolean) => Promise<void>
}

export interface BatchOutcome {
  total: number
  success: number
  failed: number
  /** 失败条目的展示名 */
  failures: string[]
  /** 是否被中途停止 */
  aborted: boolean
  /** 未执行的条数 */
  remaining: number
}

/**
 * 依次打开链接。打开目标 App 会让 Scripting 退到后台，
 * 由 `between` 决定什么时候继续下一条（默认立即继续）。
 */
export async function runBatch(
  items: BatchItem[],
  options: BatchOptions,
  open: (item: BatchItem) => Promise<boolean>
): Promise<BatchOutcome> {
  let success = 0
  let failed = 0
  let completed = 0
  const failures: string[] = []

  for (let index = 0; index < items.length; index++) {
    if (options.isCancelled()) break
    const item = items[index]
    options.onProgress?.(index, items.length, item.label)

    let opened = false
    try {
      opened = await open(item)
    } catch (error) {
      console.log("runBatch: open failed", item.raw, error)
      opened = false
    }
    if (opened) success++
    else {
      failed++
      failures.push(item.label)
    }

    completed = index + 1
    options.onProgress?.(completed, items.length, item.label)

    if (completed >= items.length) break
    if (options.isCancelled()) break
    if (options.between) {
      // 这一钩子出错不能拖垮整个批量（曾经因为钩子里调了一个不存在的函数而中断）
      try {
        await options.between(item, index, opened)
      } catch (error) {
        console.log("runBatch: between failed", error)
      }
    }
  }

  return {
    total: items.length,
    success,
    failed,
    failures,
    aborted: options.isCancelled() && completed < items.length,
    remaining: items.length - completed,
  }
}

export function summarizeBatch(outcome: BatchOutcome): string {
  const parts = [`共 ${outcome.total} 条`, `成功 ${outcome.success} 条`]
  if (outcome.failed > 0) parts.push(`失败 ${outcome.failed} 条`)
  if (outcome.aborted) parts.push(`已停止（剩余 ${outcome.remaining} 条）`)
  else parts.push("全部处理完毕")
  return parts.join("，")
}
