# EmbyLibraryKit 设计说明

## 数据流

输入文本先按以下顺序尝试解析：

1. 订阅 JSON：转换为 `SubscriptionServer[]`。
2. 开通通知：提取主线路、备用线路、用户名与密码。
3. 导入链接：解析为 `SchemeEntry[]`。

随后统一通过 `SubscriptionServer` 进入目标 App URL 构建器，再由批量导入引擎逐条调用系统 URL Scheme。

## 分层

- 解析层：`notice.ts`、`subscription.ts`、`parse.ts`。
- 转换层：`apps.ts`，保持各 App 参数顺序和备用线路格式。
- 存储层：`store.ts`、`library.ts`、`backup.ts`。
- UI 层：`src/ui/`，页面只负责交互和状态编排。
- 运行层：`index.tsx`、`batch.ts`、`foreground.ts`。

## 安全边界

密码只在本机内存、脚本私有 Storage 或系统钥匙串相关流程中使用；示例和源码不得写入真实服务器、账号或密码。历史记录默认不保存密码。

## 通知解析注意事项

通知中的分隔线可能位于地址字段之前，也可能位于正文末尾。解析器只在已经发现 URL 后将后续分隔线视为正文终止标记，避免误截断服务器地址。密码字段支持“初始密码”“体验密码”等以“密码”结尾的字段，但会排除安全密码、锁屏密码等非登录凭据。
