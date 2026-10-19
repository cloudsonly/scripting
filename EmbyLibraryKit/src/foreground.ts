import { AppEvents } from "scripting"

const POLL_MS = 250
const MIN_DWELL_MS = 800
export const DEFAULT_WAIT_CAP_MS = 10000

let continueToken = 0

export function requestContinue(): void {
  continueToken++
}

let returnEpisodes = 0
let awaySince = 0
let armed = false

function onPhase(phase: string): void {
  if (!armed) return
  if (phase === "background" || phase === "inactive") {
    if (!awaySince) awaySince = Date.now()
    return
  }
  if (phase === "active" && awaySince) {
    awaySince = 0
    returnEpisodes++
  }
}

export function startReturnWatch(): () => void {
  try {
    AppEvents.scenePhase.addListener(onPhase)
  } catch (error) {
    console.log("startReturnWatch: scenePhase 不可用，只用 onResume 与兜底上限", error)
    return () => {}
  }
  return () => {
    try {
      AppEvents.scenePhase.removeListener(onPhase)
    } catch (error) {
      console.log("startReturnWatch: 取消订阅失败", error)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms))
}

export async function waitForReturn(
  isCancelled: () => boolean,
  capMs = DEFAULT_WAIT_CAP_MS,
  onWait?: (waiting: boolean) => void
): Promise<boolean> {
  const startToken = continueToken
  const startEpisodes = returnEpisodes
  const startedAt = Date.now()
  armed = true
  awaySince = 0
  onWait?.(true)
  try {
    while (true) {
      if (isCancelled()) return false
      if (continueToken !== startToken) return true
      const away = Date.now() - startedAt
      if (returnEpisodes !== startEpisodes && away >= MIN_DWELL_MS) return true
      if (capMs > 0 && away >= capMs) return true
      await sleep(POLL_MS)
    }
  } finally {
    armed = false
    awaySince = 0
    onWait?.(false)
  }
}
