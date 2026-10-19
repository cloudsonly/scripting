# cloudsonly / scripting

Scripting App 脚本合集。每个子目录都是一个独立的源码项目，可直接在 Scripting 中导入运行；同名 `.scripting` 文件保留为兼容安装包。

## 脚本

| 脚本 | 说明 | 源码 |
| --- | --- | --- |
| EmbyLibraryKit | 媒体库管理、开通通知解析与 Rex / Forward / SenPlayer / Vidora / EplayerX 批量导入 | [源码](EmbyLibraryKit/) |
| AgentRouter签到 | 多账号签到、日志核验、余额与桌面小组件 | [源码](AgentRouter签到/) |
| 媒体库导入助手 | 识别导入链接、订阅 JSON 与开通通知并批量导入 | [源码](媒体库导入助手/) |

## 安装

在 Scripting App 中打开对应源码目录即可导入运行：

- [EmbyLibraryKit](EmbyLibraryKit/)
- [AgentRouter签到](AgentRouter签到/)
- [媒体库导入助手](媒体库导入助手/)

兼容旧版安装流程的 `.scripting` 包也暂时保留在仓库根目录。

## 开发约定

每个脚本目录包含：

- `script.json`：脚本元信息、入口与源码仓库更新地址
- `index.tsx`：主入口
- `README.md`：使用说明与目录结构
- `design.md`：架构与功能设计（适合维护和二次开发）

类型检查可在 Scripting 的脚本目录运行：

```sh
scripting-ts project "脚本名称" --check
```

## 安全

源码中不写入 Token、密码、Cookie 或个人账号。凭据使用系统 Keychain，本地数据使用脚本私有 Storage；README 示例使用 `example.com`、`test`、`123456`。

## 发布

发布时从同一份源码同时更新：

1. GitHub 源码目录；
2. 同名 `.scripting` 兼容安装包；
3. 脚本目录中的 `script.json` 与版本说明。

这样既方便网页审查和协作，也兼容旧版 Scripting 导入方式。
