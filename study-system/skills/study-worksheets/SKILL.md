---
name: study-worksheets
description: 为已议定采用自组巩固卷的课程选题与编排：能力覆盖、草案、题源核验、去重和卷面要求。不负责课程方法选择或笔记写作。
---

# 自组巩固卷

## 自组巩固卷的执行规范

只有课程已议定使用自组卷时才启用。来源、语言、批改要求和节奏由 COURSE.md 决定。官方待做练习仍用原文件；明确采用官方补充材料作为选题来源的课程，不再并列要求整份候选题单。

### 编排前

先读课程约定、实际授课终点、已发与已做历史、assessment 和 learning_issues、适用历年卷与原题。汇总各能力已练与待练数量、真实错误和复测、考法与推理要求、官方待做题；无证据写未知，不编造错误率。无作答记录不等于薄弱，一次正确不等于稳定掌握。

在现有 PRACTICE_SELECTION.md 本课段原位写草案：证据、重点能力、各能力练习量、题型与小问、排除与去重理由、未覆盖能力的后续检查条件。先确定重点再选题，不要求每卷覆盖全部主题；技法熟练度、方法选择、条件辨析、证明或建模按该课实际能力要求安排。难度来自推理，不靠繁琐计算、模糊语言或超纲制造。

后续新卷以约10道大题为目标，按当次重点和实际总负担调整，不为凑题数增加题目。个别微积分计算大题可含3–4个相关短小题；不能全卷都按每题3–4个小题编排，也不能把多道完整题藏进小问。草案及成品核验同时统计大题、小题和完整计算／证明／编程任务，检查整卷负担。已有未完成卷继续原卷，不因新题量偏好自动重制；学生明确要求修订时保留原作答。

选题提高真实历史错点及其相关能力的比重。优先处理尚未通过复测、再次出错或反复不稳定的发现；已通过的历史错点按必要迁移与间隔检验选取，不机械全部重做。可选原题复测或课程认可题源中的同类题，须能关联原 assessment／learning_issue 证据；不得虚构错点或原因。保留未充分练习的已讲能力，不让整卷只剩旧题重复。草案列出本次采用的错点证据、对应题／小问及暂不采用的理由，无真实错误记录时明确写无，不硬凑比例。

草案完成、正文尚未开始时，运行下方 prepare，以保存当时本课草案。后续有理由调整草案时先记录变更，再在新正文之前重新 prepare；不能补写理由冒充前置草案。

### 选题与交付

逐题核验原题、图形、题号、条件和来源。与官方待做、已做及前卷按题目和小问去重；确需复测的历史题说明依据。按课程认可题源选择，不另造题库。题目标题不提示解法；历年题只提供已核验的考法参照，不声称精确预测本次难度。

题面完整且答案隐藏，作答区留空白，不画横线或设置卡点栏。编译后逐页检查字形、公式、图形、裁切和留白；对照草案核对范围、重点、练习量、推理要求和去重。未兑现则修订，必要时说明有证据的草案变化。

按本 Skill 的 accept 保存实际核验与成品哈希到现有 evidence 回执，然后更新原任务入口与剩余条件、来源及发卷历史、课程状态和必要视图。发卷不代表作答。学生反馈按 Skill 入账并影响后续选题，保留首次表现与复测历史。验收后运行 finish_work；中间文件不作为长期引用。


## 草案完成后、正文之前

```bash
python3 ../study-system/tools/delivery_review.py prepare .study-system/runtime/WORK --course COURSE --kind worksheet --input .study-system/PRACTICE_SELECTION.md
```

完成选题与编排后，按本 Skill 的试卷核验段对照上述草案和实际成品验收。此 Skill 不固定课程名单；本学期题源、节奏、批改与例外在 COURSE.md。

## 试卷核验与收尾

逐题读回原题及来源，核对题号、小问、条件、图形和完整题面；比对官方待做题、已做和已发题，确需复测的重复说明依据。读取正文之前保存的本课草案，对照最终卷的范围、重点、各能力练习量、推理要求和去重结果。未兑现先修订，不能事后补理由冒充前置草案。

渲染最终 PDF 并逐页核对：题面、公式和必要图形显示完整，答案隐藏，标题不暗示方法，作答空间和页码清楚。未通过页修订并复查。核对原持续练习入口、剩余范围及官方任务边界，不因发卷认定作答。

工作目录中的 review.json 写入实际 artifact_sha256、page_count、pages（每页的 page、status=passed、summary），以及 checks：source_scope、layout、task_handoff、plan_alignment、deduplication、source_questions、question_load、issue_weighting。question_load 记录大题数、小题分布和整体负担；issue_weighting 记录真实历史错点如何影响选题及对应证据，无记录时据实说明。填写实际逐题核验、草案对照和视觉检查，不用泛泛“已检查”替代。

```bash
python3 ../study-system/tools/delivery_review.py accept .study-system/runtime/WORK --artifact COURSE/practice/FINAL.pdf --receipt .study-system/evidence/RECEIPT.json --review .study-system/runtime/WORK/review.json
python3 ../study-system/tools/finish_work.py .study-system/runtime/WORK --artifact COURSE/practice/FINAL.pdf --receipt .study-system/evidence/RECEIPT.json
```

accept 合并现有 JSON 回执，保存原草案和实际核验，不新增要求文件。输入、课程或出卷规范改变、页码遗漏、未通过页或哈希不符时拒绝验收。验收后更新原任务、草案与发卷历史，按运行 Skill 更新必要视图，再清理本轮临时目录。工具不证明实际读题、渲染或语义核对已经发生，Codex 须如实执行。历史已验收卷不追补。
