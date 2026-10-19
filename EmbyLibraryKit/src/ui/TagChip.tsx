import { HStack, Image, Text, VStack, useObservable, FlowLayout } from "scripting"
import {
  ACCENT,
  CARD_FILL,
  CHIP_OFF_FILL,
  CHIP_OFF_TEXT,
  CHIP_ON_TEXT,
  DANGER,
} from "./tokens"

export interface TagOption {
  label: string
  count?: number
  on: boolean
  action: () => void
  longPress?: () => void
}

type TagChipProps = TagOption & {
  editing?: boolean
  onRemove?: () => void
  textMaxWidth?: number
  lifted?: boolean
}

function tapWithHaptic(action: () => void) {
  try {
    HapticFeedback.lightImpact()
  } catch (error) {
    console.log("haptic failed", error)
  }
  action()
}

export function TagChip(props: TagChipProps) {
  const on = props.on && !props.editing
  const removable = props.editing === true && !!props.onRemove
  const filled = on || props.lifted === true
  const pressed = useObservable(false)

  function tap() {
    tapWithHaptic(() => {
      pressed.setValue(true)
      setTimeout(() => pressed.setValue(false), 110)
      props.action()
    })
  }

  function remove() {
    tapWithHaptic(() => {
      if (props.onRemove) props.onRemove()
    })
  }

  function longPress() {
    tapWithHaptic(() => {
      if (props.longPress) props.longPress()
    })
  }

  return (
    <HStack
      spacing={removable ? 6 : 0}
      padding={removable ? { leading: 8, trailing: 12, vertical: 8 } : { horizontal: 12, vertical: 8 }}
      background={filled ? ACCENT : CHIP_OFF_FILL}
      clipShape="capsule"
      scaleEffect={pressed.value ? 0.94 : 1}
      animation={{ animation: Animation.smooth({ duration: 0.22 }), value: filled }}
      contentShape={{ kind: "interaction", shape: "rect" }}
      onTapGesture={tap}
      {...(props.longPress
        ? { onLongPressGesture: { minDuration: 320, perform: longPress } }
        : {})}
    >
      {removable ? (
        <Image
          systemName="minus.circle.fill"
          font={16}
          foregroundStyle={DANGER}
          contentShape={{ kind: "interaction", shape: "rect" }}
          onTapGesture={remove}
        />
      ) : null}
      <Text
        font="footnote"
        foregroundStyle={filled ? CHIP_ON_TEXT : CHIP_OFF_TEXT}
        lineLimit={1}
        truncationMode="tail"
        {...(props.textMaxWidth ? { frame: { maxWidth: props.textMaxWidth, alignment: "center" } } : {})}
      >
        {props.count === undefined ? props.label : `${props.label} ${props.count}`}
      </Text>
    </HStack>
  )
}

export function TagGroup(props: {
  items: TagOption[]
  empty?: string
  editing?: boolean
  onRemove?: (label: string) => void
  pickedLabel?: string
}) {
  const pickedKey = (props.pickedLabel || "").toLowerCase()
  const signature = props.items
    .map(item => `${item.on && !props.editing ? "1" : "0"}${item.label.toLowerCase() === pickedKey ? "p" : ""}`)
    .join("")
  if (props.items.length === 0) {
    if (!props.empty) return null
    return (
      <Text font="caption" foregroundStyle="secondaryLabel">
        {props.empty}
      </Text>
    )
  }
  return (
    <VStack
      alignment="leading"
      spacing={10}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
      padding={{ horizontal: 12, vertical: 12 }}
      background={CARD_FILL}
      clipShape={{ type: "rect", cornerRadius: 14 }}
      animation={{ animation: Animation.smooth({ duration: 0.22 }), value: signature }}
    >
      <FlowLayout spacing={8} horizontalSpacing={8} verticalSpacing={8}>
        {props.items.map(item => (
          <TagChip
            key={item.label}
            {...item}
            editing={props.editing}
            lifted={item.label.toLowerCase() === pickedKey}
            onRemove={props.onRemove ? () => props.onRemove?.(item.label) : undefined}
          />
        ))}
      </FlowLayout>
    </VStack>
  )
}
