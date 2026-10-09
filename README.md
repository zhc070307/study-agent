# Study Agent

一个独立的学习 agent 项目。复用开源 agent harness，以代码管理学习流程，并提供本机浏览器 GUI。

当前阶段：已接入精简的 DeepSeek Harness，复用现有学习账本；材料处理和作答反馈流程可保存、恢复和修改。当前只在云端验证与修改 GitHub，GUI 和本机部署尚未实现。

## 已确认的方向

- 本项目独立开发；现有自用 Study System 继续运行。
- 当前开发在云端工作区进行，代码与设计修改提交到 GitHub；暂不安排本机安装、部署或使用新功能。下述本机浏览器 GUI 是产品目标，不是当前部署任务。
- GitHub 仓库先设为私有。
- 第一版在本机运行，通过浏览器使用 GUI。
- 第一版业务范围覆盖本机现有学习服务的内容；实现可分步推进，不将某条候选流程当作全部范围。
- 复用开源 harness 的模型调用、会话和工具执行能力。已采用固定版本 DeepSeek Harness。
- harness 管理流程阶段、上下文装配、前置条件、状态转换、证据保存和中断恢复。模型负责理解、建议、生成与批改。
- 流程融入 harness，同时允许模型根据用户要求修改 harness 中的流程定义和相关执行代码，使修改后的流程实际生效；不把模型的作用限制为在固定流程中填充内容。
- 系统规范模型检查材料、保存依据和核验结果，不替用户规定学习顺序。阅读与练习可以自由安排，任务依赖必须有具体依据。
- 课程方法需要根据材料和学生沟通确定；不把当前学期的课程名单、题源或节奏写入通用流程。
- 笔记写作和笔记核验、选题编排和试卷核验分别承担自己的职责。风格与教学要求由相应阶段提供给模型。
- 真实错误与复测必须关联作答证据；材料到达、讲解或发卷不等于掌握。
- 程序与个人数据分离。课程材料、作答、数据库、运行记录和密钥不上传本仓库。示例数据须不含个人资料。

## 现有服务的业务范围与实现依据

以下清单已对照仓库内 `study-system/` 源码、CLI、工具与 Skill 核对。它是现有服务的功能基线；具体课程名单、教材、节奏与例外仍属于学期和课程数据。

| 业务 | 现有能力与入口 |
| --- | --- |
| 学期与课程管理 | `study` / `workspace.py` 选择独立学期账本；`course add/setup` 注册课程并建立目录和 `COURSE.md`。课程方法由材料分析和学生沟通形成，程序不自动选择方法。 |
| 材料处理 | `material scan/inspect/claim/release/close` 发现文件变化、跟踪处理状态与回执；结合录音、转录、课件和正式要求核对实际范围，承接笔记与任务。扫描不证明材料已读或课程已讲。 |
| 当前上下文与日历 | `context now/course` 按层装配全局与课程上下文、材料事件、周池、错点和状态；macOS `calendar-events` 只读获取日程，学习判断由上层 agent 完成。 |
| 任务与学习计划 | `task` 管理任务身份、完成条件、证据、依赖、取消和恢复；`pool` 管理周池，`today` 选择当日任务，`view` 生成清单并同步勾选。任务完成与知识掌握分别判断。 |
| 课程状态核对 | `course state-status/state-reviewed` 核对账本与 `COURSE.md` 的版本；`map-review/map-reviewed` 管理材料地图复核。程序检查版本一致性，agent 核对学习含义与范围覆盖。 |
| 笔记制作与验收 | `study-notes` 规定输入准备、知识正文写作、图形版式、编译、逐页检查和修订；`delivery.py` 保存写作依据与核验回执，`lecture_note_quality.py` 提供辅助检查。现有 pi 作者与 Codex 编译分工属于参考实现，新项目模型配置尚未确定。 |
| 练习与考试复习 | `study-system` 规定官方练习、持续概念检测、反馈与复测的承接；`study-worksheets` 规定自组巩固卷和复习卷的证据草案、选题、题源核对、去重、题量负担与逐页验收。采用哪些方法由课程约定决定。 |
| 作答、错点与复测 | `assessment record/list/retest` 与 `assessment.py` 保存 assessment、learning_issues 和关联结果，保留初次错误及复测历史；后续选题读取统一账本。批改与诊断依赖真实作答及 agent 判断。 |
| 行动记忆与恢复 | `memory` 维护全局行动记忆及语义整理检查点；课程快照、数据库备份和归档支持回看与恢复。`lifecycle.py` 在启动、提示、工具操作、结束和中断时提醒核对，并恢复未完成的清理。 |
| 交付、维护与自动触发 | `delivery_review.py` 的 prepare/accept 核对依据、版本、页码记录和成品哈希；`finish_work.py` 在持久成品与回执存在后清理临时工作目录。课程约定的定时检查由宿主自动化触发，源码快照不包含现有自动任务配置或独立调度服务。 |

现有业务主要沿以下流程衔接：

- 新课程：注册与建立入口 → 分析材料并沟通方法 → 保存课程约定 → 建立实际需要的任务与完成条件。
- 新材料：发现变化 → 领取并检查材料 → 更新范围及课程状态 → 制作或复用笔记、承接正式义务与练习 → 保存处理回执。
- 日常学习：同步勾选 → 装配上下文 → 核对课程状态 → 选择周池与今日任务 → 执行或接收学生反馈 → 更新账本和视图。
- 反馈与练习：保存作答及诊断 → 关联错点、剩余任务和复测 → 按证据制定出卷草案 → 选题与核验 → 保存交付证据并清理 → 等待独立作答。

现有程序提供持久状态、事务和部分前置检查；课程判断、写作、选题、批改以及实际内容和视觉核验仍由 Codex 按 Skill 执行。核验字段与哈希完整不证明语义正确。新 harness 需要承接这些阶段并落实流程约束，不能仅把 Skill 文本交给模型就视为接入完成。

## 流程执行与修改

用户要求的方向是：harness 执行学习流程，模型也有能力依据用户要求修改 harness 来调整流程。阶段、分支、顺序、前置条件、上下文和工具组合应可随需求演进，而非固化为永远不变的流程。

当前实现只有一个学习插件、一个 Python 领域入口和一份初始流程定义，分别位于 `harness/study.ts`、`harness/worker.py` 和 `harness/flows.json`。复用原账本和交付检查，不再另建模型循环、会话系统或工具框架。

模型使用三个工具：读取学习状态，执行有依据的操作，根据用户要求验证并采用流程修改。用户表达学习需求即可，不需要填写技术配置。模型可以修改课程或通用流程的说明、证据依赖及 Python 执行代码；新增代码必须提供输入和预期结果示例，通过检查后才能启用。

流程定义的列表顺序不构成执行顺序。只有显式的 `after` 表示模型操作的证据依赖，例如先有选题依据再核验成品。阅读笔记和做练习不是默认前后关系；材料处理只要求模型检查内容、按需求接续实际任务并保存回执，可以复用已有工作或不新增任务。

修改和运行所用版本保存在学习账本中，重启后仍生效。新运行采用当前版本；正在进行的运行保留原版本，按用户要求可切换尚未完成的操作。已完成记录和原始输入不改写；修改失败保留原流程，支持恢复上个版本。重复调用不重复登记作答或任务。

执行代码按可信应用代码运行。独立进程、临时目录和超时用于检查与恢复，不是任意代码的安全隔离。示例验证不证明教学判断正确；真实作答、内容检查和逐页核验仍由模型依据材料完成。

## 已采用与保留的能力

| 能力 | 实现选择 |
| --- | --- |
| 模型调用、会话历史和恢复 | 采用上游实现。 |
| 工具校验、取消、执行记录和插件卸载 | 采用上游实现。 |
| 读写文件和调用原学习服务 | 采用上游持久 shell，使用独立学习目录和同一账本。 |
| 学习任务、错点、复测、周池、今日计划、记忆、备份和交付检查 | 保留现有领域代码；上游没有相应学习业务实现。 |
| 学习操作进度、证据与可持久修改的流程 | 新增小型学习插件；上游动态插件和多 agent workflow 不具备这些完整能力。 |

运行组合保留模型、会话、工具、shell 和学习插件，关闭无关的标题生成、MCP 资源、后台 jobs、包清单和 PowerShell 插件。完整上游源码作为固定版本 submodule 保留，便于核对与升级。当前不加入 Web/桌面 UI、浏览器、多 agent 编排或额外插件管理界面。

新文件先记为未知类型。模型读内容后通过 `material classify` 登记类型与依据；所属课次也需明确登记，不再按文件名、扩展名或日期猜测和归组。

## 待完成的工作

- 配置真实 DeepSeek API 后，验证模型是否能正确理解要求、生成修改并完成实际学习任务。
- 按完整业务范围继续接入日常计划等专用流程；目前这些能力可经原服务调用，尚未逐条完成 Harness 场景验收。
- 确定 GUI 和模型分工；macOS 日历、实际 PDF 生成与视觉核验需对应环境。历史 Skill 中的本机 Codex/pi 分工仍需适配。
- 本机安装与部署暂不进行。

## 考察来源

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [工具接口与执行约束](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
- [桌面与 Web 基础](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

用户已确认接入方案，并要求系统简洁、避免写死学习判断；以下实现与验证据此完成。

## DeepSeek Harness 验证结果

考察版本固定为 [`5badb15009ae1756c3afe0ae0cef1faafc290ccc`](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc)，仓库版本字段为 `0.2.1-alpha.1`。环境为 Linux x86_64/glibc、Node 24.19.0、pnpm 11.19.0（上游声明 pnpm 11.7.0）。API 仍处于 pre-stable 阶段，后续升级需显式复核接口。

运行了 6 个定向测试文件，共 218 项，全部通过：上游工具执行与并发策略、AgentLoop 持久会话恢复、动态插件更新失败回滚、Plugin Manager 的 Loader 重载，以及本项目的临时 Python 账本桥接。桥接验证了实际模型循环中的工具调用能保存学习任务，重建 Context 后能恢复历史；新插件版本将下一项任务从笔记变为练习，原账本与会话历史保留。直接通过 Python 领域操作完成没有证据的任务仍被拒绝；卸载桥接插件后工具消失。

模型循环测试使用脚本化 MockAdapter，插件修改由验证程序提供。此外，通过支持的 `dsh --profile sdk-minimal` 启动实际 profile，SDK initialize 返回正常的 `deepseek-harness-sdk-runtime` 身份，shutdown 返回正常并以状态码 0 退出。此握手证明该 profile 能启动并解析模型配置，不证明真实模型能正确理解用户要求、编写修改或判断教学内容。当前没有配置 DeepSeek API 凭据，真实推理请求及模型修改流程的端到端验证尚未进行。

完整 monorepo 安装在当前网络环境中无法获取文档预览所用的 SheetJS tarball。定向验证改为安装所需插件依赖闭包，未替换该依赖或改变上游 lockfile。云端 Node 缺少附带开发头文件；使用同版本官方 Node 头文件及上游编译参数构建 flock 模块后，会话恢复测试通过。复现脚本安装时跳过生命周期脚本，只显式编译验证所需模块；这不是完整产品构建验证。

复现定向验证（Linux x86_64/glibc，需 Node、pnpm、Python、Git、curl、tar 和 C 编译器）：

```bash
bash verification/deepseek-harness/run.sh
# 或复用已经检出的固定版本：
bash verification/deepseek-harness/run.sh /path/to/deepseek-harness
```

SDK profile 握手另行复现：在固定版本 checkout 中运行 `pnpm --filter '*' --filter '!@deepseek-ai/dsh-client-ui-sidebar-documentpreview' install --frozen-lockfile --ignore-scripts`，然后从本项目运行 `python3 verification/deepseek-harness/sdk-smoke.py /path/to/deepseek-harness`。它使用临时 Harness home，只初始化和关闭 SDK，不发送推理请求；文档预览插件未安装，不代表完整 Web 应用验证。

脚本默认在临时目录获取固定版本，测试使用独立临时账本与 Session 目录；传入已有 checkout 时会安装依赖、构建 native 模块，并临时加入随后移除的验证文件。验证代码不是新产品的流程实现。

接口核对的关键结论：

- Cordis plugin、`agent/pre-step`、`agent/request`、工具执行管线及 `agent/turn-stopping` 可用于阶段上下文、前置检查与收尾。业务前置条件还需在执行领域操作的入口落实，不能只靠 prompt 或工具隐藏。
- Session JSONL 可以恢复模型历史和处理中断的调用；它不自动恢复学习流程进度，也不保证与 Python SQLite 的业务写入原子提交，需要自己的操作身份、幂等与对账。
- 上游 `workflow` 主要是模型编写的多 agent 编排脚本，不是现成的学习业务状态机；不能直接替代学习流程的持久状态与证据检查。
- 动态 Cordis 定义只在当前进程、当前 Session 内存在，重启会丢失；当前模型工具 `cordis_inspect_*` 只读，不能创建动态定义。持久安装与配置更新使用 Creator 模式的 Plugin Manager。
- Plugin Manager 改动作用于整个 profile；开启 HMR 时可立即加载，未开启时需重启。headless/SDK 默认关闭 HMR。Host 插件运行在进程中，动态 runner 的 VM 也不提供安全隔离，不能宣称任意生成代码可安全热替换。

## 当前融合实现的验证与运行

Linux 云端准备依赖和执行隔离验证：

```bash
bash harness/setup.sh
bash harness/check.sh
```

最新结果：原领域测试 208 项（207 通过、1 跳过），新增流程测试 15 项全部通过，上游定向测试及融合循环测试共 220 项全部通过；实际精简 SDK profile 的启动、工具调用和持久写入检查通过。模型测试使用脚本化响应，所有学习数据都来自临时目录。

新增验收覆盖：原始作答及未完成步骤重启恢复；重复调用不重复登记；课程修改不影响其他课程；执行代码修改确实改变结果；失败修改不生效；在途切换不改写已完成证据；独立操作不强制先后；不凭文件名分类；材料回执和成品核验不能缺少必要依据；清理失败保留恢复文件且不阻断其他课程。

开发入口 `python3 harness/run.py --data /path/to/independent-study-data` 通过上游 `sdk-minimal` 提供 JSON-RPC 服务。它不是面向学生的交互界面。学习数据位于指定目录，默认 `.data/`；账本使用原服务布局 `.study-system/data/task_memory.sqlite3`，Harness 会话另存在 `.harness/`，两者都不提交 GitHub。模型可从 `study_read` 返回的入口调用原任务、计划、复测等服务。

当前没有真实 API 推理、完整 Web 应用和正式上游构建验收。将全部上游源文件统一套用严格 TypeScript 配置的检查出现上游源码诊断；本项目插件没有类型诊断，不能据此宣称完整构建通过。依赖安装仍排除未使用的文档预览包，并仅显式构建会话需要的 flock 模块。

## 现有 Study System 参考源码

`study-system/` 是现有自用程序的独立源码快照，供云端检查和后续设计参考。它包含 Python 程序、SQL migrations、测试、工具源码、生命周期钩子与三份通用 Skill；现已由学习插件复用。复制与测试不修改原自用系统。

上传排除了虚拟环境、缓存、编译后的日历工具、签名文件、数据库、日志、运行目录、备份、课程材料、个人作答和学习证据。测试在临时目录创建独立账本；评估场景中的课程、时间、任务身份和来源名称已改为示例。Skill 保留现有流程与模型分工，供检查现状，不表示新项目已采纳其中每项约束。

云端可先运行现有 Python 测试：

```bash
cd study-system/app/task-memory
PYTHONPATH=src python3 -m unittest discover -s tests -t .
```

Python 包要求 Python 3.9 或以上，运行依赖使用标准库。Swift 日历工具依赖 macOS EventKit；其源码与构建脚本已保留，Linux 云端不能运行该工具。PDF 质量工具需要 `pdftotext`；编译与视觉检查仍需相应 LaTeX 和 PDF 工具。

本次云端在独立临时数据上运行上述测试命令：208 项，207 项通过、1 项跳过。此结果验证参考 Python 实现，不代表 macOS 日历、pi 模型调用、PDF 成品或新 harness 已通过运行验证。

`.study-workspace.example.json` 提供不含个人内容的配置。使用时复制为 `.study-workspace.json`，创建独立的 `local-semester/`，再执行 `study-system/study --workspace local-semester init`。这会新建空账本，不包含任何历史学习数据。现有业务说明见 `study-system/README.md` 与 `study-system/skills/`；不上传真实学期目录。
