import { FlowLayout, Image, Text, VStack } from "scripting"
import type { IconEntry } from "../iconLibrary"

export function IconGrid(props: { icons: IconEntry[]; size?: number; onPick: (icon: IconEntry) => void }) {
  const size = props.size === undefined ? 56 : props.size
  return (
    <FlowLayout spacing={10} horizontalSpacing={10} verticalSpacing={12}>
      {props.icons.map(icon => (
        <VStack
          key={icon.url}
          alignment="center"
          spacing={4}
          frame={{ width: size + 22 }}
          contentShape={{ kind: "interaction", shape: "rect" }}
          onTapGesture={() => props.onPick(icon)}
        >
          <Image
            imageUrl={icon.url}
            resizable={true}
            frame={{ width: size, height: size }}
            clipShape={{ type: "rect", cornerRadius: 10 }}
            placeholder={<Text font="caption2" foregroundStyle="quaternaryLabel">…</Text>}
          />
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
            {icon.name}
          </Text>
        </VStack>
      ))}
    </FlowLayout>
  )
}
