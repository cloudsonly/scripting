# 媒体库导入助手设计说明

## 数据流

输入文本按订阅 JSON、开通通知、导入链接的顺序识别，统一转换为服务器模型，再根据目标 App 生成对应导入 URL，最后由批量引擎逐条打开。

## 模块

- `index.tsx`：入口与全屏页面呈现。
- `src/parse.ts`：导入链接解析、校验、去重。
- `src/subscription.ts`：订阅 JSON 与线路模型转换。
- `src/notice.ts`：开通通知字段与线路识别。
- `src/apps.ts`：Rex、Forward、SenPlayer、Vidora、EplayerX 与自定义模板 URL 构建。
- `src/batch.ts` / `src/foreground.ts`：批量导入与返回前台检测。
- `src/store.ts`：设置、记录和自定义模板存储。
- `src/ui/`：交互页面。

## 安全边界

完整链接可能含密码，仅保存在本机脚本私有 Storage，不写入源码和仓库；README 示例统一使用 example.com、test、123456。
