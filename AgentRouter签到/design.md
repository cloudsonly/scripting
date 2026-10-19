# AgentRouter签到设计说明

## 数据流

账号由 App 内设置页维护，密码通过系统 Keychain 保存。签到时执行登录、签到日志核验与余额读取；成功登录后保存会话，用于后续免登录刷新余额。

## 模块

- `index.tsx`：入口，支持正常 UI 与 `?auto=1` 静默签到。
- `views.tsx`：主页、账号管理、结果与历史 UI。
- `agentrouter.ts`：登录、签到核验、会话、余额、通知和批量导入逻辑。
- `widget.tsx`：桌面小组件余额看板。

## 安全边界

密码不写入源码、README 或 GitHub；密码只使用系统 Keychain 保存。Storage 只保存账号元数据、会话状态和结果历史。
