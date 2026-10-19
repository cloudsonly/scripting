import { Text, useObservable } from "scripting"
import { ACCENT, CONTROL_HEIGHT, DANGER } from "./tokens"
import type { FillColor } from "./tokens"

let effectsEnabled = true

export function setButtonEffects(enabled: boolean): void {
  effectsEnabled = enabled
}

function haptic(color: FillColor | undefined): void {
  try {
    if (color === DANGER) HapticFeedback.rigidImpact()
    else HapticFeedback.lightImpact()
  } catch (error) {
    console.log("haptic failed", error)
  }
}

export function PillButton(props: { title: string; color?: FillColor; disabled?: boolean; action: () => void }) {
  const pressed = useObservable(false)

  function tap() {
    if (props.disabled) return
    if (effectsEnabled) {
      haptic(props.color)
      pressed.setValue(true)
      setTimeout(() => pressed.setValue(false), 110)
    }
    props.action()
  }

  return (
    <Text
      frame={{ maxWidth: "infinity", minHeight: CONTROL_HEIGHT, alignment: "center" }}
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
