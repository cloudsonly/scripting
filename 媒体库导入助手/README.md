# 媒体库导入助手

在 Scripting 里显示为「媒体库导入助手」，目录名同名。

两种输入，都会变成 `rex://import` 之类的导入链接，勾选后逐条打开对应 App 实现批量导入：

1. **一堆导入链接**（剪贴板 / 文本文件 / 手动输入），任意 Scheme：

```
rex://import?type=emby&scheme=https&host=emby.example.com&port=443&username=test&password=123456&title=%F0%9F%8C%95MyServer
senplayer://importserver?type=emby&name=xx&address=https://a.example.com:443&username=test&password=123456
vidora://emby/import?server_url=http%3A%2F%2Fa.example.com%3A8096&username=test&password=123456
```

2. **线路汇总 JSON**（自动识别，转换成 `rex://import`）：

```json
[{
  "originalAddress": "https://emby.example.com:443",
  "nowAddress": "https://emby.example.com:443",
  "account": "test",
  "password": "123456",
  "sourceType": "emby",
  "icon": "https://…png",
  "name": "MyServer",
  "lines": [{ "address": "https://line1.example.com:443", "isNow": false, "name": "¹HKG" }]
}]
```

顶层数组、或 `{ servers / data / list / items / results: [...] }` 均可；每项的字段也容忍别名（`title` 当 name，`address`/`url`/`host` 当地址，`username`/`user` 当账号……；`remark` 是备注，不当名称）。

## 仓库源码

源码目录：`https://github.com/cloudsonly/scripting/媒体库导入助手`

每次发布同时更新源码目录和同名 `.scripting` 兼容安装包。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `index.tsx` | 入口：`Navigation.present({ element, modalPresentationStyle: "overFullScreen" })`（全屏；用 `fullScreen` 关闭时会弹「没有脚本」），dismiss 后 `Script.exit()` |
| `src/parse.ts` | 链接文本 → 条目（正则提取 + 查询参数解析 + 去重 + 字段校验） |
| `src/subscription.ts` | 订阅 JSON → 服务器条目（`parseSubscriptionJSON()` / `serverFromEntry()` / `linesFromEntry()`） |
| `src/apps.ts` | 导入目标 App 预设 + 链接生成（`buildURL()`，参数表按各家官方文档，含 Rex 的 `lineN/lineNtitle`、自定 URL Scheme） |
| `src/batch.ts` | 批量执行引擎 `runBatch()`（顺序、失败统计、可取消、`between` 钩子决定何时继续） |
| `src/foreground.ts` | `waitForReturn()`：判定用户已回到本页（`Script.onResume` → `requestContinue()` / 定时器补跑漂移 ≥900ms / 10 秒兜底），并有 800ms 最小停留 |
| `src/store.ts` | Storage 读写：设置（`schemeBatch.settings`）、导入记录（`schemeBatch.history`）、已保存的自定 URL Scheme（`schemeBatch.templates`） |
| `src/notice.ts` | 开通通知（「创建用户成功 / 恢复成功」）文本 → 条目 |
| `src/ui/BatchImportPage.tsx` | 主页面；`EntryRow` 已导出、组件接受 `initialText` prop，便于 `preview_ui` 单独预览 |
| `src/ui/HistoryView.tsx` | 「导入记录」页：单行左划删除（`ForEach` + `editActions="delete"`）、多选删除/导入、每行 ✎ 编辑 / ⤓ 重新导入 |
| `src/ui/EntryEditorView.tsx` | 单条条目的参数编辑页（名称/类型/协议/主机/端口/路径/账号/密码/备用线路 + 生成链接预览） |
| `src/ui/TextEditorView.tsx` | 全屏文本编辑页（用 Scripting 原生 `Editor` + `EditorController`，`title` / `confirmTitle` / `hint` 可覆盖文案） |
| `src/ui/ParamDocView.tsx` | 某个 App 的 URL Scheme 参数说明（内置 App 只读；只有**自定方案页**可编辑：示例区 + 参数「键入」到光标 + 全屏编辑 / 覆盖保存 + 右上角 🗑 删除并回主页；返回时未保存会问一句） |
| `src/ui/TemplateEditorView.tsx` | 自定 URL Scheme 的取名弹层（内容 + 名称两个输入框；右上角「保存」= 写入方案 + `dismiss({template, templates, savedId})` 回传并关闭，「取消」不写任何东西） |
| `src/ui/PillButton.tsx` | 全站共用的胶囊按钮（`Text` + `onTapGesture` 自绘，见下方「多个按钮」注意事项）；点击时 `HapticFeedback` 轻震 + `scaleEffect` 缩一下，由模块级 `setButtonEffects()` 总控 |

## 导入记录（右上角 🕘）

- 每条记录保存：链接哈希、完整导入链接（`raw`，含密码，**仅存本机 Storage**）、导入目标 App、名称、主机、账号、时间。
- **单行左划删除**（系统交互）；右上角「**选择**」进入多选模式 → 行首勾选 + 「删除所选」「导入所选」「全选」。
- 每行右侧：**✎** 编辑该记录的参数（保存后按记录自己的 App 重建链接）、**⤓** 重新导入这一条（「导入所选」多个则依次等待回到本页）。
- 旧版本记录没有 `raw`，无法重新导入/编辑，只能删除（页脚会提示数量）。
- 重新导入会跳过「跳过已导入过的链接」限制（本来就是已导入过的）。
- 重新导入**不会**把这些链接灌回主页的待导入列表：只跑这一批，主页的输入框、识别结果和勾选都保持原样（回主页只是为了看进度和「停止」）。

## 输入源（自动识别）

优先级：**订阅 JSON** → **开通通知** → **导入链接**。

- 订阅 JSON：见上文例子。
- 开通通知（`src/notice.ts`，规则移植自「Emby 导入助手」）：识别「创建用户成功 / 恢复成功」等消息里的 `· 用户名称 | xxx`、`密码为：`、`您的账号xxx已恢复成功`、`主线路/线路一/测试线路`；账号与密码写入导入链接，**安全密码与到期时间**存在 `SchemeEntry.note`（列表行橙色显示、参数编辑页可查看），不写入链接；没有地址的通知会生成待补地址的条目，点行中间进编辑页填主机即可。
- 线路命名（对齐用户自制快捷指令的做法）：先看字段行的字段名（`线路一: https://…`、`主线路:` 换行写地址），没有字段名就**反查地址前面紧邻的原文标签**（同行 `电信 https://…`，或标签单独占一行 `备用一` + 换行地址；`labelBeforeURL()` 会去掉行首符号与结尾冒号，且拒绝「字段名：值」式的尾巴，避免把密码当线路名），两者都没有才退回 `线路N` 编号；名称一律取原文，不从域名推导。`t.me` / `telegram.me` / `telegram.org` 的机器人与频道链接直接剔除，不会被收成备用线路。
- 通知识别的兜底：直接粘「`线路：https://… / 用户名：xxx / 密码：xxx`」这种没有关键词的简版也能识别（出现 `线路/用户名/密码` 或「账号 | 值」「密码：值」字段行即判定为通知）；反过来，含有任何非 http(s) 的 scheme 链接的文本不会被误判成通知。
- 导入链接：正则抽取任意 `scheme://` 链接。

## 交互约定

- 「待导入列表」上方的选择按钮只有 **全选 / 反选**（曾有第三个「仅未导入」，跟「高级」里的「跳过已导入过的链接」是一回事，删了）。「高级」区三个开关，页脚各说一句作用：**跳过已导入过的链接**（导入时略过「导入记录」里已有的同一条链接，按 `raw` 比对，改了参数就会重新导入）、**结束后发送通知**（跑完发一条本机通知汇报成功/失败）、**按钮动效与震动**（点胶囊按钮时 `HapticFeedback` 轻震 + 按钮缩一下；存 `settings.buttonFX`，切换时用 `setButtonEffects()` 写进 `PillButton` 模块，关掉两个效果都没有）。
- 待导入列表一行：**行首圆点**或**中间文字** = 勾选/取消；行末两个图标 **✎（`square.and.pencil`）打开参数编辑弹层**、**⤓（`square.and.arrow.down`）只导入这一条**（无效条目只显示 ✎，正好用它补地址）。图标用 `Image` + `onTapGesture` + `contentShape`，不用 `Button`。
- 参数编辑页是**弹层**（`Navigation.present(…, { modalPresentationStyle: "pageSheet" })` + 子视图 `Navigation.useDismiss()` 回传新参数），这样主页列表不会被卸载，关闭后仍停在原来那一行（曾经用整页替换，会跳回顶部）。
- 工具栏：左上 ✕（关闭）、右上 🕘（导入记录）、右上 ⟲（`arrow.counterclockwise`，重置：当前输入与识别结果都清掉）。
- 「识别结果」下方显示来源：`剪贴板` / `文件（文件名）` / `手动输入`；剪贴板或文件来源被手动改过数据时附加显示 `+ 手动输入`。
- 「导入到」区页脚一行有两个蓝色入口（都是 `Text font="caption"` + `onTapGesture`，同一字号；选中自定方案时左边那个显示为 **编辑 ›**，内置 App 才显示 **参数说明（<App>）›**，右边永远是 **自定URL Scheme（新建）›**）。`ParamDocView` 本身：**内置 App 的说明页只读**——完整示例按易读形式排版（一行 scheme、之后每个参数一行，并用 `decodeURIComponent` 还原编码；页脚注明真实链接仍需编码），参数行只有名称 / 必填 / 说明。**只有「自定URL Scheme」页可编辑**：完整示例区就是**当前生效的方案正文**（内联 `Editor`，220pt 高，不带 `showAccessoryView` 那排左右移/删除按钮），下方两个按钮 **全屏编辑**（跳 `TextEditorView`，改完点「完成」写回示例区）和 **保存**：选中了已保存方案时按钮是 **保存到「<名字>」**，点了就地覆盖、不弹层、停在本页；还没名字时点 **保存** 才打开 `TemplateEditorView` 取名，**弹层右上角就是唯一的「保存」**（原来的「完成」和下方保存按钮合并成一个，底下只剩名称输入框）：点了 = 写入方案 + 采用它 + 一路回主页，点「取消」则什么都不写。**删除** 放在导航栏右上角（`Button systemImage="trash" role="destructive"`，与其他工具栏项一起放 `topBarTrailing`，状态提示「已键入 X」也在同一处）；图标没有文字，所以删之前先 `Dialog.confirm` 问一句，确认后这条方案连正文一起删掉，目标落到**还存在的选项**（剩下的第一条已保存方案，一条不剩就切回 Rex），并**直接回主页**——主页选单不会留下没有主人的「未命名」那一项。参数行右侧 **键入** = 把占位符插到示例区光标处（有选区则替换选区）；**点参数名** = 只进剪贴板（行尾不再有「复制」按钮）。点 **返回** 时若有未保存改动，用全局 `Dialog.actionSheet` 问「保存到「X」/ 保存并取名 / 丢弃改动 / 取消」，取消就留在本页——不会静悄悄丢内容。
- 「目标 App」选单 = **5 个内置 App + 每条已保存方案**（tag 是 `custom:<方案 id>`；选项**只写名字**，不加 emoji 也不配色——实测 `Picker` 自己渲染选项行，选项 `Text` 上的 `foregroundStyle` 会被丢掉，着色这条路走不通）。「导入到」区页脚最右侧的「自定URL Scheme（新建）›」= **新建**一份未命名方案（默认骨架，**绝不**按文本反查合并到同名旧方案上），之后在它的「编辑 / 参数说明」页里改 / 存 / 删。**未命名方案是临时的**：`openCustomTemplateDoc` 前会把进入前的现场存进 `pendingNewRef`，返回时若一个字都没改就整体撤销（`abandonNewTemplate`），只有改名保存（`savedId`）或明确丢弃才落地。组件挂载时还会把设置里残留的「`appId: custom` 但 `activeTemplateId` 找不到对应方案」归一化掉（绑到剩下的第一条，一条不剩就切回 Rex），所以正常路径下选单里看不到那条兜底的 **未命名 Scheme（记得保存）**。⚠ 受控 `Picker` 的 `value` 必须是它渲染出来的某个 tag，否则显示会卡在上一个名字上、点那个名字也不触发 `onChanged`（Rex 选不中、参数说明消失的那个 bug 就是这么来的）。
- 来源区的「解析文本」在输入框上方（不会被挤出屏幕），输入框右侧 ⤢ 图标进全屏编辑。

## 关键实现

- 打开链接用**全局** `Safari.openURL(url)`（`Safari` 是全局命名空间，**不能**从 `scripting` import）。内置 App 全是自定义 scheme（`rex://`、`eplayerx://` 等）；自定 URL Scheme 写成 https 通用链接也能打开。未安装对应 App 时返回 `false`，不抛异常。
- **无固定时间间隔**：每条打开后调用 `waitForReturn()` 等用户回到本页再继续。三个继续条件（任一满足）：① 页面订阅的 `Script.onResume` 或用户点「立即下一条」→ `requestContinue()`；② 定时器被冻结过（补跑 ≥900ms）且已停留 ≥800ms；③ 最多等 10 秒兜底。没真正打开 App 的条目不会等待。
- 回调钩子要容错：`runBatch` 里 `options.between(...)` 包了 try/catch（曾经钩子里调了一个不存在的导出（`waitForReturn` 少了 export），导致第一条之后整个批量中断）。
- ⚠ **同一个 `HStack` 里的多个自绘 `Button` 会互相连触**（曾经：读剪贴板同时弹文件选择器、复制链接同时清记录、全选实际等于不选）。因此 `PillButton` 用 `Text` + `contentShape` + `onTapGesture` 自绘（已验证多个并列互不干扰）；行内其他操作也都是单按钮或 gesture。改版时切勿把两个 `<Button>` 放回同一个 `HStack`。
- 「已导入」记录存 `schemeBatch.history`（`{id,title,host,account,type,app,raw,at}[]`，最多 500 条；`raw` 是完整导入链接、**含密码，只存本机 Storage**，用于重新导入与编辑），同时用于「跳过已导入过的链接」；旧版 `schemeBatch.done`（仅 id）会在 `loadHistory()` 里自动迁移。
- 生成链接按「导入目标 App」生成，参数名与顺序对齐各家**官方参数表**（Rex / Forward / EplayerX 见仓库根目录 `各目标App的 url scheme 规则.txt`，SenPlayer 见其官方 URL Schemes 文档，Vidora 无公开文档、按真实样例逐字节校验），预设见 `src/apps.ts`：
  - **Rex**：官方 `rex://import?type=&scheme=&host=&port=&username=&password=&title=` + `line1=https%3A%2F%2F…&line1title=¹分流&line2=…&line2title=…`（`type`/`scheme`/`host` 必选；地址带路径时在 port 后额外写 `server_path=/npo`——官方表里没有这项，实测有效）
  - **Forward**：与 Rex 共用同一份官方参数表，只换 scheme（`forward://import?…`）
  - **SenPlayer**：官方 `senplayer://importserver?type=&name=&note=&address=&username=&password=&icon=` + `address1name=¹分流&address1=https%3A%2F%2F…`（`type` 必须小写；`note` = 服务器备注，只取链接/编辑页里填写的备注；备用线路仅 emby / jellyfin / feiniu 支持且需 5.7.0+；`icon` 没有数据来源所以不写）
  - **Vidora**：`vidora://emby/import?server_url=&server_path=&username=&password=&name=` + 重复 `backup=名称%7C地址`（`server_url` = `协议://主机:端口`，`server_path` = 地址里的路径，两者分开传；`username` 必填；`backup` 最多 60 条）
  - **EplayerX**：官方 `eplayerx://add-or-update?type=&name=&remark=&href=&username=&password=` + 一个 `backupHref=地址;线路名,地址2;线路名2`（多条线路写进同一个参数，条间用 `,` 分隔、每条内 `地址;名称`，与 Vidora 的 `名称|地址` 相反；`,``;` 按官方示例保持原样不编码，只编码线路名；账号/密码为空就不写空参数）。官方示例给的是同参数的 https 通用链接 `https://eplayerx.com/add-or-update?…`，要用那种形态就写进「自定URL Scheme」
  - **自定URL Scheme**（内部 id 仍是 `custom`）：正文 + 占位符 `{appScheme}{appPath}{type}{protocol}{host}{port}{path}{address}{username}{password}{title}{remark}{lines}`（值已 URL 编码，`{lines}` 按预设的线路风格展开，Vidora 的 `backup` 最多取 60 条）；默认骨架就是按 Rex / Forward 官方顺序排的；可命名保存复用，选中后从主页「编辑 ›」进去修改 / 覆盖保存 / 删除（删除会直接回主页）（见「交互约定」）。`{remark}` **只**在参数编辑页显式填写「备注」时才有值——开通通知里的安全密码/到期时间不写入链接。
- 反向解析：`linesFromEntry()` 同时认 `lineN/lineNtitle`（Rex/Forward）、`addressNname/addressN`（SenPlayer）、`backup=名称|地址`（Vidora）、一个逗号串多条的 `backupHref=地址;线路名`（EplayerX）、`lines=JSON`，所以粘贴任意一种链接都能“逆解析”，再切目标 App 时会带出备用线路。
- 勾选保留分两条路径（`applyServers(..., keepSelection)`）：**换目标 App / 换方案**用 `host|port|account` 映射原样保留当前勾选，包括「全部取消」也不会被默认全选覆盖；**识别新来源**（剪贴板 / 文件 / 手动解析）才按「有效且非重复」默认全选。订阅 JSON 来源无损，从链接文本识别的内容可能丢失未识别参数。
- 启动参数：`scripting://run/媒体库导入助手?text=<URL 编码后的文本>` 会在打开时直接解析（JSON 也可以）。
- 生成的链接与 App 自己生成的完全同构，已用真实样例逐字节校验：`rex://import?type=emby&scheme=https&host=…&port=443&username=…&password=…&title=…`。
- 解析要点：`rex://import?…` 里 `import` 是 URL 的 host 段，被当作 `action`；`scheme=https` 是传输协议（`transport`）；`type` 统一转小写（SenPlayer 只认小写）；`note` 按 SenPlayer 官方语义当作服务器备注（归到 `remark`，不再当成显示名称）；**识别不到服务器名称就留空**（开通通知与订阅 JSON 都不再拿登录账号 / 主线路域名顶名），各 App 只在有名称时才写 `title` / `name`，列表行则退回显示 `主机:端口`；完全相同的链接去重丢弃，同「主机+端口+用户名」但其他参数不同的会被标记「重复账号」并默认不勾选。

## 维护提示

- `get_typescript_diagnostics` 对相对导入（`./src/...`、`../parse`）会误报 `Cannot find module`，并连带把来自该模块的回调参数报成 implicit any；`Emby 导入助手` 同样如此，属已知误报。
- `background` / `foregroundStyle` 等颜色属性只接受颜色**字面量**类型（`#RRGGBB` 模板字面量或关键字），传 `string` 类型的变量会报类型错误——本项目的 `PillColor` 就是为此存在的。
- 自测套路：同目录建临时 `_*.tsx` 用 `scripting-ts run` 跑（记得结尾 `Script.exit()`，否则命令会挂到超时），UI 用 `preview_ui --screenshot` 或 `project "…" --queryparameters '{"text":"…"}' --screenshot` 验证，完事删除。
- ⚠ `Storage` 的作用域按运行方式不同：项目的 `index.tsx`/`preview_ui` 读的是用户真实数据（`schemeBatch.settings` / `schemeBatch.done`），而同目录下用 `scripting-ts run _xxx.tsx` 跑的临时文件读到的可能是**另一个命名空间**（曾实测返回 `null`）。别用临时脚本给用户数据做备份/清理，以免误判。

