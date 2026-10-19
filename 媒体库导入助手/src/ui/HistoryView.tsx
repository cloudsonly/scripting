import { Button, ForEach, HStack, Image, List, Section, Text, VStack, useEffect, useObservable, useState } from "scripting"
import type { HistoryRecord } from "../store"
import { formatRecordTime } from "../store"
import { ACCENT, DANGER, PillButton, SUCCESS } from "./PillButton"

const ICON_HIT = { kind: "interaction", shape: "rect" } as const

/** 一条导入记录：勾选状态与行内操作全部由 props 决定（不在内部读组件 state） */
function RecordRow(props: {
  record: HistoryRecord
  checked?: boolean
  onToggle?: () => void
  onEdit?: () => void
  onImport?: () => void
}) {
  const record = props.record
  return (
    <HStack spacing={12}>
      {props.onToggle ? (
        <Image
          systemName={props.checked ? "checkmark.circle.fill" : "circle"}
          font={20}
          foregroundStyle={props.checked ? ACCENT : "tertiaryLabel"}
          onTapGesture={props.onToggle}
        />
      ) : null}
      <VStack
        alignment="leading"
        spacing={2}
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        onTapGesture={props.onToggle}
      >
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
          {[formatRecordTime(record.at), record.app || "未知 App", record.host, record.account]
            .filter(value => !!value)
            .join(" · ")}
        </Text>
      </VStack>
      {props.onEdit && props.onImport ? (
        <HStack spacing={14}>
          <Image
            systemName="square.and.pencil"
            font={19}
            foregroundStyle={ACCENT}
            padding={4}
            contentShape={ICON_HIT}
            onTapGesture={props.onEdit}
          />
          <Image
            systemName="square.and.arrow.down"
            font={19}
            foregroundStyle={SUCCESS}
            padding={4}
            contentShape={ICON_HIT}
            onTapGesture={props.onImport}
          />
        </HStack>
      ) : null}
    </HStack>
  )
}

/**
 * 导入记录页：
 * - 单行左划删除（`ForEach` + `editActions="delete"` 的系统交互）
 * - 右上角「选择」→ 多选删除 / 多选导入
 * - 每行右侧：✎ 编辑参数（弹层）、⤓ 重新导入这一条
 */
export default function HistoryView(props: {
  records: HistoryRecord[]
  onBack: () => void
  onClear: () => void
  onDelete: (ids: string[]) => void
  onChange: (records: HistoryRecord[]) => void
  onEdit: (record: HistoryRecord) => void
  onImport: (records: HistoryRecord[]) => void
}) {
  const records$ = useObservable<HistoryRecord[]>(() => props.records.slice())
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  // 外部改动（清除 / 编辑 / 删除）同步进 observable
  useEffect(() => {
    const current = records$.value
    const same =
      current.length === props.records.length && current.every((item, index) => item.id === props.records[index]?.id)
    if (!same) records$.setValue(props.records.slice())
  }, [props.records])

  // 列表内改动（左划删除）→ 回传父级持久化
  useEffect(() => {
    const handler = (value: HistoryRecord[]) => props.onChange(value.slice())
    records$.subscribe(handler)
    return () => {
      records$.unsubscribe(handler)
    }
  }, [])

  const records = records$.value
  const importable = records.filter(record => record.raw)
  const pickedRecords = records.filter(record => picked.includes(record.id))
  const pickedImportable = pickedRecords.filter(record => record.raw)

  // 按 App 统计
  const counts: Array<{ app: string; count: number }> = []
  for (const record of records) {
    const app = record.app && record.app.length > 0 ? record.app : "未知"
    const found = counts.find(item => item.app === app)
    if (found) found.count++
    else counts.push({ app, count: 1 })
  }
  const breakdown = counts.map(item => `${item.app} ${item.count}`).join(" · ")

  function toggle(id: string) {
    setPicked(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]))
  }

  return (
    <List
      navigationTitle={selecting ? `已选 ${picked.length}` : "导入记录"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="返回" action={props.onBack} />,
        confirmationAction: (
          <Button
            title={selecting ? "完成" : "选择"}
            action={() => {
              setSelecting(!selecting)
              setPicked([])
            }}
          />
        ),
      }}
    >
      {selecting ? (
        <Section header={<Text>批量操作</Text>} footer={<Text>「导入所选」会把这批链接重新导入到它们各自记录的 App。</Text>}>
          <HStack spacing={10}>
            <PillButton
              title={`删除所选（${picked.length}）`}
              color={DANGER}
              disabled={picked.length === 0}
              action={() => {
                props.onDelete(picked)
                setPicked([])
              }}
            />
            <PillButton
              title={`导入所选（${pickedImportable.length}）`}
              color={SUCCESS}
              disabled={pickedImportable.length === 0}
              action={() => props.onImport(pickedImportable)}
            />
          </HStack>
          <PillButton
            title={picked.length === records.length && records.length > 0 ? "取消全选" : `全选（${records.length}）`}
            disabled={records.length === 0}
            action={() => setPicked(picked.length === records.length ? [] : records.map(record => record.id))}
          />
        </Section>
      ) : (
        <Section
          header={<Text>{records.length > 0 ? `共 ${records.length} 条记录` : "暂无记录"}</Text>}
          footer={
            <Text>
              {breakdown ? `${breakdown}\n` : ""}
              左划可删除单条；点右上角「选择」可多选删除 / 导入。记录含完整导入链接（可再次导入），只保存在本机。
            </Text>
          }
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
        {records.length === 0 ? <Text foregroundStyle="secondaryLabel">还没有导入记录。</Text> : null}
        {selecting
          ? records.map(record => (
              <RecordRow
                key={record.id}
                record={record}
                checked={picked.includes(record.id)}
                onToggle={() => toggle(record.id)}
              />
            ))
          : /* ForEach 只在 data 变化时重跑 builder，所以 builder 里不能读 selecting / picked */
            <ForEach
              data={records$}
              editActions="delete"
              builder={(record: HistoryRecord) => (
                <RecordRow
                  key={record.id}
                  record={record}
                  onEdit={record.raw ? () => props.onEdit(record) : undefined}
                  onImport={record.raw ? () => props.onImport([record]) : undefined}
                />
              )}
            />
        }
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
