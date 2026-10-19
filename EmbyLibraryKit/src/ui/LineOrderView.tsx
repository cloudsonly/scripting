import { Button, ForEach, HStack, List, Navigation, NavigationStack, Section, Text, VStack, useState } from "scripting"

export interface LineOrderItem {
  id: string
  name: string
  address: string
}

export interface LineOrderResult {
  items: LineOrderItem[]
}

function reorder(list: LineOrderItem[], indices: number[], newOffset: number): LineOrderItem[] {
  const moving: LineOrderItem[] = []
  for (const index of indices) if (list[index]) moving.push(list[index])
  if (moving.length === 0) return list
  const rest = list.filter((_, index) => indices.indexOf(index) < 0)
  const offset = newOffset > rest.length ? rest.length : newOffset < 0 ? 0 : newOffset
  return rest.slice(0, offset).concat(moving, rest.slice(offset))
}

export default function LineOrderView(props: { items: LineOrderItem[] }) {
  const dismiss = Navigation.useDismiss()
  const [items, setItems] = useState<LineOrderItem[]>(props.items)

  function move(indices: number[], newOffset: number) {
    setItems(reorder(items, indices, newOffset))
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="线路顺序"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
          confirmationAction: <Button title="完成" action={() => dismiss({ items })} />,
        }}
      >
        <Section header={<Text>{`共 ${items.length} 条`}</Text>}>
          <ForEach
            count={items.length}
            itemBuilder={index => (
              <HStack key={items[index].id} spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="caption" foregroundStyle="tertiaryLabel">
                  {`${index + 1}`}
                </Text>
                <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text bold={true} lineLimit={1}>
                    {items[index].name || "未命名线路"}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} truncationMode="middle">
                    {items[index].address}
                  </Text>
                </VStack>
              </HStack>
            )}
            onMove={move}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}
