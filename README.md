# Scripting

[Scripting](https://scriptingapp.github.io/) App 脚本合集。每个子目录都是一个独立的源码项目，可直接在 Scripting 中导入运行。

## 脚本

| 脚本 | 说明 |
| --- | --- |
| [EmbyLibraryKit](EmbyLibraryKit/) | 媒体库管理、开通通知解析与 Rex / Forward / SenPlayer / Vidora / EplayerX 批量导入 |
| [AgentRouter签到](AgentRouter签到/) | 多账号签到、日志核验、余额与桌面小组件 |

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

源码中不写入 Token、密码、Cookie 或个人账号。凭据使用系统 Keychain，本地数据使用脚本私有 Storage。
