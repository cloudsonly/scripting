# EmbyLibraryKit

Scripting App 的媒体库管理与批量导入工具。

## 功能

- 管理 Emby / Jellyfin 等媒体服务器库，支持分组、标签、图标与排序。
- 从剪贴板、文件或手动文本识别导入链接、订阅 JSON 与开通通知。
- 将服务器转换为 Rex、Forward、SenPlayer、Vidora、EplayerX 或自定义模板的导入链接。
- 支持备用线路、历史记录、批量导入、媒体库增量更新，以及小幻影视（afusekt）格式导入导出。

## 项目结构

- `index.tsx`：脚本入口与更新说明检查。
- `src/notice.ts`：开通通知解析。
- `src/subscription.ts`：订阅 JSON、服务器与导入条目转换。
- `src/apps.ts`：各目标 App 的导入 URL 构建。
- `src/parse.ts`：导入链接解析、校验与去重。
- `src/library.ts` / `src/backup.ts`：媒体库与备份格式处理。
- `src/ui/`：SwiftUI 风格页面组件。

## 在 Scripting 中运行

直接将本目录导入 Scripting App，或通过脚本管理工具导入。源码不包含任何账号、密码或 Token；用户数据保存在脚本私有 Storage，敏感凭据不会写入仓库。

## 开发检查

```sh
scripting-ts project "EmbyLibraryKit" --check
```

入口内的更新说明注入块可能被静态检查器误报 `fetch`，不影响脚本运行。
