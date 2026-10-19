export interface BatchItem {
  id: string
  raw: string
  label: string
}

export interface BatchOptions {
  isCancelled: () => boolean
  onProgress?: (done: number, total: number, current: string) => void
  between?: (item: BatchItem, index: number, opened: boolean) => Promise<void>
}

export interface BatchOutcome {
  total: number
  success: number
  failed: number
  failures: string[]
  aborted: boolean
  remaining: number
}

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
  if (outcome.aborted) parts.push(`已停止 剩余 ${outcome.remaining} 条`)
  else parts.push("全部处理完毕")
  return parts.join(" ")
}
