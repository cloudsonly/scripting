const SNAPSHOT_SUBDIR = "/EmbyLibraryKit-backups"
const LEGACY_SNAPSHOT_SUBDIR = "/媒体库导入助手-backups"
const SNAPSHOT_FILE = "/data.json"

export interface SnapshotPayload {
  schema: number
  savedAt: number
  scriptVersion: string
  settings: Record<string, unknown>
  templates: unknown[]
  history: unknown[]
  servers: unknown[]
  groups: unknown[]
  iconLibraries?: unknown[]
}

function pathIn(subdir: string): string {
  const base = FileManager.documentsDirectory || ""
  if (!base) return ""
  return base + subdir + SNAPSHOT_FILE
}

export function snapshotPath(): string {
  return pathIn(SNAPSHOT_SUBDIR)
}

export function writeSnapshot(payload: SnapshotPayload): boolean {
  try {
    const path = snapshotPath()
    if (!path) return false
    const dir = path.slice(0, path.lastIndexOf("/"))
    try {
      FileManager.createDirectory(dir, true)
    } catch (error) {
      console.log("建立快照目录失败", error)
    }
    FileManager.writeAsStringSync(path, JSON.stringify(payload))
    return true
  } catch (error) {
    console.log("writeSnapshot failed", error)
    return false
  }
}

function readSnapshotAt(subdir: string): SnapshotPayload | null {
  try {
    const path = pathIn(subdir)
    if (!path) return null
    if (!FileManager.existsSync(path)) return null
    const parsed = JSON.parse(FileManager.readAsStringSync(path))
    if (!parsed || typeof parsed !== "object") return null
    if (!Array.isArray(parsed.servers) && !Array.isArray(parsed.templates) && !Array.isArray(parsed.history)) return null
    return parsed as SnapshotPayload
  } catch (error) {
    console.log("readSnapshot failed", error)
    return null
  }
}

export function readSnapshot(): SnapshotPayload | null {
  return readSnapshotAt(SNAPSHOT_SUBDIR) || readSnapshotAt(LEGACY_SNAPSHOT_SUBDIR)
}

export function looksEmpty(input: {
  servers: unknown[]
  groups: unknown[]
  templates: unknown[]
  history: unknown[]
  iconLibraries?: unknown[]
}): boolean {
  return (
    input.servers.length === 0 &&
    input.groups.length === 0 &&
    input.templates.length === 0 &&
    input.history.length === 0 &&
    !(input.iconLibraries || []).length
  )
}
