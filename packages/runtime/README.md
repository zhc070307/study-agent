# Study Agent 运行核心

从 DeepSeek Harness 的指定版本选取的运行能力，已纳入本项目作为普通源码维护，来源及完整许可见 `SOURCE.json`、`LICENSE` 和根目录 `THIRD_PARTY_NOTICES.md`。

- `launcher/`：我们的启动入口及采用的可靠启动、配置和关闭实现。
- `modules/`：模型循环、会话、工具、附件、模型适配、持久命令执行，以及它们需要的服务与检查支持。
- `foundation/`：所需 Cordis 基础库，各自保留 MIT 许可。
- `native/`：会话写锁等原生支持，保留 BSD-3-Clause 许可；编译产物不提交 GitHub。

不包含原项目的独立桌面/网页应用、账户平台、Office 工具或完整 CLI。内部模块身份保留 `@deepseek-ai/*` 以维护稳定引用，源码由本仓库提供，不从 npm 下载这些内部包，也不克隆原仓库。配置仅组装实际需要的 SDK 服务，由 `packages/agent/` 加入学习业务。

对外统一使用根目录 `study-agent`。依赖在根目录安装并由本项目锁文件固定。数据布局与原 JSONL 会话格式保持兼容。后续变更由本项目维护，按需吸收上游修复，不盲目覆盖我们的改造。
