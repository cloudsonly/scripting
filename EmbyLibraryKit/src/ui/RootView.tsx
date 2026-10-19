import { NavigationStack, Script, Tab, TabView, useEffect, useObservable, useRef, useState } from "scripting"
import type { HistoryRecord, SavedIconLibrary, SavedTemplate, Settings } from "../store"
import { loadHistory, loadIconLibraries, loadSettings, loadTemplates, saveHistory, saveIconLibraries, saveSettings, saveTemplates } from "../store"
import type { LibraryGroup, LibraryServer } from "../library"
import { loadLibrary, normalizeTags, saveLibrary } from "../library"
import { looksEmpty, readSnapshot, writeSnapshot } from "../backup"
import { requestContinue, startReturnWatch } from "../foreground"
import ParsePage from "./ParsePage"
import LibraryPage from "./LibraryPage"
import SettingsPage from "./SettingsPage"

export default function RootView() {
  const selection$ = useObservable<number>(0)
  const [tab, setTab] = useState(0)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [history, setHistory] = useState<HistoryRecord[]>(() => loadHistory())
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates())
  const [iconLibraries, setIconLibraries] = useState<SavedIconLibrary[]>(() => {
    const stored = loadIconLibraries()
    console.log("启动读取图标库", stored.length, JSON.stringify(stored.map(item => item.url)))
    return stored
  })
  const [library, setLibrary] = useState<{ servers: LibraryServer[]; groups: LibraryGroup[] }>(() => loadLibrary())
  const [restored, setRestored] = useState("")

  const snapshotRef = useRef(snapshotSeed())
  snapshotRef.current = snapshotSeed()

  function snapshotSeed() {
    return { settings, history, templates, iconLibraries, library }
  }

  function scheduleBackup() {
    setTimeout(() => {
      const state = snapshotRef.current
      writeSnapshot({
        schema: 2,
        savedAt: Date.now(),
        scriptVersion: Script.metadata.version || "",
        settings: state.settings as unknown as Record<string, unknown>,
        templates: state.templates,
        history: state.history,
        servers: state.library.servers,
        groups: state.library.groups,
        iconLibraries: state.iconLibraries,
      })
    }, 700)
  }

  useEffect(() => {
    const listener = (value: number) => setTab(Number(value))
    selection$.subscribe(listener)

    const removeResume = Script.onResume(() => requestContinue())
    const removePhaseWatch = startReturnWatch()

    const snapshot = readSnapshot()
    if (snapshot) {
      const state = snapshotRef.current
      const empty = looksEmpty({
        servers: state.library.servers,
        groups: state.library.groups,
        templates: state.templates,
        history: state.history,
        iconLibraries: state.iconLibraries,
      })
      if (empty) {
        const servers = ((snapshot.servers || []) as LibraryServer[]).map(item => ({
          ...item,
          tags: normalizeTags(item.tags || []),
        }))
        const groups = (snapshot.groups || []) as LibraryGroup[]
        const records = (snapshot.history || []) as HistoryRecord[]
        const schemes = (snapshot.templates || []) as SavedTemplate[]
        const libraries = (snapshot.iconLibraries || []) as SavedIconLibrary[]
        const nextSettings =
          snapshot.settings && typeof snapshot.settings === "object"
            ? ({ ...settings, ...snapshot.settings } as Settings)
            : settings
        saveLibrary(servers, groups)
        saveHistory(records)
        saveTemplates(schemes)
        saveIconLibraries(libraries)
        saveSettings(nextSettings)
        setLibrary({ servers, groups })
        setHistory(records)
        setTemplates(schemes)
        setIconLibraries(libraries)
        setSettings(nextSettings)
        setRestored(
          `已从数据快照找回：媒体库 ${servers.length} 台 / 分组 ${groups.length} 个 / 方案 ${schemes.length} 条 / 记录 ${records.length} 条 / 图标库 ${libraries.length} 个`
        )
      }
    }
    return () => {
      selection$.unsubscribe(listener)
      removeResume()
      removePhaseWatch()
    }
  }, [])

  function updateSettings(patch: Partial<Settings>): Settings {
    const next: Settings = { ...loadSettings(), ...patch }
    setSettings(next)
    if (!saveSettings(next)) console.log("设置写入本机失败")
    scheduleBackup()
    return next
  }

  function writeIconLibraries(list: SavedIconLibrary[]) {
    setIconLibraries(list)
    const ok = saveIconLibraries(list)
    console.log("图标库写入", ok, list.length, JSON.stringify(list.map(item => item.url)))
    if (ok) scheduleBackup()
    return ok
  }

  function writeHistory(records: HistoryRecord[]) {
    setHistory(records)
    const ok = saveHistory(records)
    if (ok) scheduleBackup()
    return ok
  }

  function writeTemplates(list: SavedTemplate[]) {
    setTemplates(list)
    const ok = saveTemplates(list)
    if (ok) scheduleBackup()
    return ok
  }

  function writeLibrary(servers: LibraryServer[], groups: LibraryGroup[]) {
    setLibrary({ servers, groups })
    const ok = saveLibrary(servers, groups)
    if (ok) scheduleBackup()
    return ok
  }

  function replaceLibrary(servers: LibraryServer[]) {
    return writeLibrary(servers, library.groups)
  }

  const showSearch = tab === 1 || tab === 3

  return (
    <TabView selection={selection$} tabViewSearchActivation="searchTabSelection">
      <Tab title="" systemImage="text.viewfinder" value={0}>
        <NavigationStack>
          <ParsePage
            settings={settings}
            updateSettings={updateSettings}
            history={history}
            writeHistory={writeHistory}
            templates={templates}
            iconLibraries={iconLibraries}
            libraryServers={library.servers}
            replaceLibrary={replaceLibrary}
          />
        </NavigationStack>
      </Tab>

      <Tab title="" systemImage="play.tv" value={1}>
        <NavigationStack>
          <LibraryPage
            mode="browse"
            settings={settings}
            updateSettings={updateSettings}
            servers={library.servers}
            groups={library.groups}
            writeLibrary={writeLibrary}
            history={history}
            writeHistory={writeHistory}
            templates={templates}
            writeTemplates={writeTemplates}
            iconLibraries={iconLibraries}
            writeIconLibraries={writeIconLibraries}
            notice={restored}
          />
        </NavigationStack>
      </Tab>

      <Tab title="" systemImage="gearshape.fill" value={2}>
        <NavigationStack>
          <SettingsPage
            settings={settings}
            updateSettings={updateSettings}
            servers={library.servers}
            groups={library.groups}
            templates={templates}
            writeTemplates={writeTemplates}
            iconLibraries={iconLibraries}
            writeIconLibraries={writeIconLibraries}
          />
        </NavigationStack>
      </Tab>

      {showSearch ? (
        <Tab title="" systemImage="magnifyingglass" value={3} role="search">
          <NavigationStack>
            <LibraryPage
              mode="search"
              settings={settings}
              updateSettings={updateSettings}
              servers={library.servers}
              groups={library.groups}
              writeLibrary={writeLibrary}
              history={history}
              writeHistory={writeHistory}
              templates={templates}
              writeTemplates={writeTemplates}
              iconLibraries={iconLibraries}
              writeIconLibraries={writeIconLibraries}
              notice={restored}
            />
          </NavigationStack>
        </Tab>
      ) : null}
    </TabView>
  )
}
