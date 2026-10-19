import { Button, EditButton, ForEach, HStack, List, Section, Text, useEffect, useObservable, VStack } from "scripting"
import type { HistoryRecord } from "../store"
import { formatRecordTime } from "../store"
import { PillButton } from "./PillButton"
import { ACCENT, DANGER, SUCCESS } from "./tokens"

function RecordRow(props: {
  record: HistoryRecord
  onEdit?: () => void
  onImport?: () => void
  onDelete: () => void
}) {
  const record = props.record
  const actions = [
    ...(props.onEdit ? [<Button key="edit" title="编辑参数" tint={ACCENT} action={props.onEdit} />] : []),
    ...(props.onImport ? [<Button key="import" title="重新导入" tint={SUCCESS} action={props.onImport} />] : []),
    <Button key="delete" title="删除" role="destructive" action={props.onDelete} />,
  ]
  return (
    <HStack spacing={12} trailingSwipeActions={{ allowsFullSwipe: false, actions }}>
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text bold={true} lineLimit={1} multilineTextAlignment="leading">
          {record.title || record.host || "（旧记录）"}
        </Text>
        <Text
          font="caption"
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          truncationMode="middle"
          multilineTextAlignment="leading"
        >
          {[formatRecordTime(record.at), record.app || "未知播放器", record.host, record.account]
            .filter(value => !!value)
            .join(" · ")}
        </Text>
      </VStack>
    </HStack>
  )
}

export default function HistoryView(props: {
  records: HistoryRecord[]
  onBack: () => void
  onClear: () => void
  onDelete: (ids: string[]) => void
  onEdit: (record: HistoryRecord) => void
  onImport: (records: HistoryRecord[]) => void
}) {
  const records$ = useObservable<HistoryRecord[]>(() => props.records.slice())
  const picked$ = useObservable<string[]>([])

  useEffect(() => {
    const current = records$.value
    const same =
      current.length === props.records.length && current.every((item, index) => item.id === props.records[index]?.id)
    if (!same) records$.setValue(props.records.slice())
  }, [props.records])

  const records = props.records
  const picked = picked$.value
  const pickedImportable = records.filter(record => picked.includes(record.id) && record.raw)
  const importable = records.filter(record => record.raw)

  const counts: Array<{ app: string; count: number }> = []
  for (const record of records) {
    const app = record.app && record.app.length > 0 ? record.app : "未知"
    const found = counts.find(item => item.app === app)
    if (found) found.count++
    else counts.push({ app, count: 1 })
  }
  const breakdown = counts.map(item => `${item.app} ${item.count}`).join(" · ")

  function deletePicked() {
    const ids = picked.slice()
    picked$.setValue([])
    props.onDelete(ids)
  }

  return (
    <List
      navigationTitle={picked.length > 0 ? `已选 ${picked.length} 条` : "导入记录"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="返回" action={props.onBack} />,
        topBarTrailing: <EditButton />,
      }}
      selection={picked$}
    >
      {picked.length > 0 ? (
        <Section header={<Text>批量操作</Text>}>
          <HStack spacing={10}>
            <PillButton title={`删除所选（${picked.length}）`} color={DANGER} action={deletePicked} />
            <PillButton
              title={`重新导入所选（${pickedImportable.length}）`}
              color={SUCCESS}
              disabled={pickedImportable.length === 0}
              action={() => props.onImport(pickedImportable)}
            />
          </HStack>
          <PillButton
            title={picked.length === records.length && records.length > 0 ? "取消全选" : `全选（${records.length}）`}
            disabled={records.length === 0}
            action={() => picked$.setValue(picked.length === records.length ? [] : records.map(record => record.id))}
          />
        </Section>
      ) : (
        <Section
          header={<Text>{records.length > 0 ? `共 ${records.length} 条记录` : "暂无记录"}</Text>}
          footer={breakdown ? <Text>{breakdown}</Text> : undefined}
        >
          <PillButton
            title={records.length > 0 ? `清除全部记录（${records.length}）` : "清除全部记录"}
            color={DANGER}
            disabled={records.length === 0}
            action={props.onClear}
          />
        </Section>
      )}

      <Section header={<Text>明细</Text>}>
        {records.length === 0 ? <Text foregroundStyle="secondaryLabel">暂无导入记录。</Text> : null}
        <ForEach
          data={records$}
          builder={(record: HistoryRecord) => (
            <RecordRow
              key={record.id}
              record={record}
              onEdit={record.raw ? () => props.onEdit(record) : undefined}
              onImport={record.raw ? () => props.onImport([record]) : undefined}
              onDelete={() => props.onDelete([record.id])}
            />
          )}
        />
      </Section>

      {importable.length < records.length ? (
        <Section footer={<Text>有 {records.length - importable.length} 条旧记录没有保存链接，无法重新导入（只能删除）。</Text>}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {`可重新导入：${importable.length} / ${records.length}`}
          </Text>
        </Section>
      ) : null}
    </List>
  )
}
