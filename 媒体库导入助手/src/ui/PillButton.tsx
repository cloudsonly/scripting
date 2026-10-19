import { Text, useObservable } from "scripting"

/** 全站统一配色：主色蓝、危险红、成功绿 */
export type AccentColor = "#0A84FF" | "#FF3B30" | "#34C759"

export const ACCENT: AccentColor = "#0A84FF"
export const DANGER: AccentColor = "#FF3B30"
export const SUCCESS: AccentColor = "#34C759"

/**
 * 「高级 → 按钮动效与震动」的开关，由主页在读取设置和切换时写入。
 * 放模块级是因为胶囊按钮散落在各个页面，逐个传 prop 会污染所有调用点。
 */
let effectsEnabled = true

export function setButtonEffects(enabled: boolean): void {
  effectsEnabled = enabled
}

/** 轻按一下：红色（危险操作）用手感更硬的 rigid */
function haptic(color: AccentColor | undefined): void {
  try {
    if (color === DANGER) HapticFeedback.rigidImpact()
    else HapticFeedback.lightImpact()
  } catch (error) {
    // 没有触觉引擎的设备（如 iPad）别让它影响点击
    console.log("haptic failed", error)
  }
}

/**
 * 胶囊按钮（主页与记录页共用）。
 *
 * 注意：**不要**用多个自绘内容的 `<Button>` 放在同一个 HStack 里 ——
 * Scripting 会把它们的 action 一起触发；这里用 Text + onTapGesture，
 * 多个并列互不干扰。
 */
export function PillButton(props: { title: string; color?: AccentColor; disabled?: boolean; action: () => void }) {
  const pressed = useObservable(false)

  function tap() {
    if (props.disabled) return
    if (effectsEnabled) {
      haptic(props.color)
      // 识别「手指按下」要额外挂一个长按手势，可能干扰点击，所以按下效果做在点击回调里
      pressed.setValue(true)
      setTimeout(() => pressed.setValue(false), 110)
    }
    props.action()
  }

  return (
    <Text
      frame={{ maxWidth: "infinity", minHeight: 34, alignment: "center" }}
      padding={{ horizontal: 10, vertical: 7 }}
      background={props.color ?? ACCENT}
      foregroundStyle="white"
      fontWeight="semibold"
      lineLimit={1}
      minScaleFactor={0.7}
      clipShape="capsule"
      opacity={props.disabled ? 0.45 : 1}
      scaleEffect={pressed.value ? 0.93 : 1}
      animation={{ animation: Animation.easeOut(0.11), value: pressed.value }}
      contentShape={{ kind: "interaction", shape: "rect" }}
      onTapGesture={tap}
    >
      {props.title}
    </Text>
  )
}
