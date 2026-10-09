# Study Agent

一个独立的学习 agent 项目。复用开源 agent harness，以代码管理学习流程，并提供本机浏览器 GUI。

当前阶段：项目初始化与架构设计。尚未实现 GUI、agent 接入或学习流程。

## 已确认的方向

- 本项目独立开发；现有自用 Study System 继续运行。
- GitHub 仓库先设为私有。
- 第一版在本机运行，通过浏览器使用 GUI。
- 复用开源 harness 的模型调用、会话和工具执行能力。DeepSeek Harness 优先考察，底座尚未最终确定。
- harness 管理流程阶段、上下文装配、前置条件、状态转换、证据保存和中断恢复。模型负责理解、建议、生成与批改。
- 课程方法需要根据材料和学生沟通确定；不把当前学期的课程名单、题源或节奏写入通用流程。
- 笔记写作和笔记核验、选题编排和试卷核验分别承担自己的职责。风格与教学要求由相应阶段提供给模型。
- 真实错误与复测必须关联作答证据；材料到达、讲解或发卷不等于掌握。
- 程序与个人数据分离。课程材料、作答、数据库、运行记录和密钥不上传本仓库。示例数据须不含个人资料。

## 待确定的设计

1. 第一版的业务范围及优先流程。
2. DeepSeek Harness 的固定版本和接入方式；通过接口及运行验证决定是否采用。
3. 学习状态的存储边界、GUI 结构和模型配置。

“作答反馈 → 错点登记 → 出卷计划 → 成品核验”是候选首条流程，尚未被确定为第一版范围。

## 考察来源

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [工具接口与执行约束](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
- [桌面与 Web 基础](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

此前考察为文档与接口审阅，尚未在本项目安装、运行或验证该 harness。正式实现前应固定版本并复核对应接口。
