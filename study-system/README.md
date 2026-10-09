# 学习系统程序

此目录保存跨学期复用的程序、测试、工具、钩子和 Skill，不保存课程材料、学习账本或运行缓存。

父目录 `.study-workspace.json` 指定 `program` 和当前 `workspace` 的相对路径。从工作区或学期目录运行 `./study`（按实际相对路径调用）。入口先选择学期，再定位该学期 `.study-system/data/task_memory.sqlite3`，不会混用学期账本。

需要打开归档学期时，使用 `study --workspace /绝对路径/学期 ...`。新学期先创建独立目录并运行 `study --workspace /绝对路径/新学期 init`，再用 course add 注册课程、course setup COURSE --root . 建立该课入口并按 Skill 与学生沟通方法；切换配置的 workspace 字段后，钩子和普通入口使用新学期。课程文件夹、COURSE.md、任务视图、选题记录、行动记忆、证据、备份和运行目录均属于各自学期。

学期结束后，停止该学期的自动化并切换配置，再把旧学期整体归档或移走。程序和用户的通用写作规范保留。普通命令不读取归档学期；当前学期缺失时明确报错，不创建空账本冒充旧数据。

学期内不保存 app/hooks/tools 或 Skill 的兼容链接。旧 PYTHONPATH 命令已退役，统一使用 study 入口；移走整个学期不会删除程序。

程序更新时在 app/task-memory 下运行测试。实际课程、数据库和证据不进入程序版本管理。工具产生的工作文件写入所选学期 runtime，验收后通过 finish_work 收尾；持续更新的主笔记源文件也归学期。

共享要求按职责维护：study-system 管课程沟通和运行，study-notes 管笔记制作与笔记验收，study-worksheets 管选题编排与试卷核验。它们均位于 skills/ 下，互相引用而不重复规则。上下文返回各自入口。交付证据使用 tools/delivery_review.py，收尾沿用 finish_work。
