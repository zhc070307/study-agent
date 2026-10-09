---
name: study-notes
description: 编写或修订学习笔记：处理输入、正文组织、文风、术语、图形和版式及 pi 写作分工。不负责练习选题。
---

# 学习笔记

课程来源、范围和例外读取 COURSE.md；学习承接按 study-system。

## 笔记可读性与交付标准

笔记编译时将 `.tex` 与 `.aux`、`.log` 等过程文件放在临时工作目录。验收通过后把 PDF 放回正式交付位置，清理旧 PDF、源文件与编译残留；持续更新的主笔记源文件按上方例外放在隐藏工作区。

Lecture Notes 是给学生直接阅读的成品，不是 Codex 的术语提纲。正文优先使用自然、具体的中文；必要英文术语应放在清楚的中文情境中，不让学生先破译术语串才能知道内容在讲什么。

正式学生笔记只放帮助理解知识点的内容：概念、推导、公式、图表、例子，以及理解模型所必需的假设和适用条件。材料来源、编写依据、收到的要求、核实过程、课堂进度、待核实范围及其他给助手看的处理说明，留在 `COURSE.md` 或材料回执中，不写进学生版 PDF。学生指出这类文字时，直接从目标笔记删除。

正文以实际讲授的知识点为主线，按概念、关系、适用条件和推理过程组织，而非按课堂讲述顺序罗列例子。课堂故事、随口举例和重复材料仅在能澄清难点、区分概念、展示应用或边界，或受到教师明确强调时保留；精选代表性例子，放在对应知识点下并点明其作用。复习版面使用有意义的层级、短段落，以及适合比较或步骤的列表／表格，避免连续大段文字；同时保留必要解释，不把正文压成关键词堆或满页项目符号。

每份笔记还须按内容的作用建立稳定的视觉层级。先识别该课实际需要的主体知识、完整应用或例题、补充说明、条件与易混边界、图表等；某类内容不存在就记为不适用，不为凑齐类别添写材料。定义、关系、推理及必要图形沿正文主线阅读；较长的例题或案例应连同题设、数据、必要图形、过程与解释作为一块可辨认的扩充内容，不把题设或结论留在框外。短例子可以留在句内。可使用框、底色、留白、缩进、标题层级或表格来区分角色，不要求各科使用同一组颜色，也不能只靠颜色传达类别。同一份笔记中同一角色的标示须一致；真正的小节标题留在框外，框内内容的短标签放在框内。不能因为一个文字片段有标题，就机械地把它移出所属的例题或提示框。

图形承担解释、计算或判读作用时，成品必须实际给出可读图形，并在相邻文字中说明坐标、关键对象及图形支持的判断；不能多处讲“图中”“曲线”却没有相应图。能清楚使用的原课件图可直接采用；重绘时须对照来源和相邻正文，核对坐标、单位、曲线形状与斜率、约束或边界、关键点、变化前后的位置，以及移动方向。图中不同状态须真正产生所要说明的差异，不能仅换颜色或标记却画出相同结果。正常阅读尺寸下，曲线与点的名称、箭头、颜色或线型及图注都须可辨，并能让读者说出“什么变化导致什么结果”。线条互相遮挡、字过小、只靠颜色区分、曲线形状失真、箭头或图注与图形不符时，须重绘或修订。无需图形的主题不强制配图。检查现行与新交付笔记时，逐份核对：主体是否能连续阅读和定位；扩充内容是否与主体区分且与对应知识点相邻；提及的必要图表是否出现且可独立判读；同类框和标签是否一致；术语、符号、语句是否清楚且前后一致；是否保留必要解释而没有过程文字。篇幅明显短于来源和旧版所覆盖的知识时，检查是否漏掉定义、推导、关键图形或必要例子，不靠增加空白和重复文字凑页数。逐页渲染检查排版，并为每份笔记记录具体页码、通过／需修订／不适用及修订后的复查结果。不得把“有彩框”“图多”或编译成功当成质量结论。知识正文和用语问题按各课既定作者分工修订；Codex 可直接修版面与图形，且不得因旧笔记曾被验收就跳过检查。

所有正式笔记均不附自检题、自测题或闭卷输出题。独立练习和无辅助检测继续作为单独的学习阶段，使用教师原题、教材习题、Tutorial、Practice Set 等适合实际已讲范围的题源；不要让学生依赖笔记末题。正文中的解题示例、结果检查方法及概念辨析仍可保留。

每门课按用途存放当前材料：正式学生笔记放 `notes/`，官方课件与 Course Notes 放 `materials/`，Tutorial、补充练习、Practice Set 和自组巩固卷放 `practice/`，正式作业与 Lab 放 `assignments/`。文件名保留课次或日期等来源线索，但不再建立日期目录。`notes/` 在文件列表中按实际讲授的 Topic 顺序排列；原文件名不能实现这一顺序时使用两位序号前缀，跨课延续的 Topic 仍更新原文件。原有 `resources/`、`admin/`、`archive/` 等专用目录继续按其用途使用。新材料入库时更新 `COURSE.md`、任务入口与清单；移动文件时同步迁移 SQLite 路径，避免扫描器误报新材料。新笔记定稿后直接放 `notes/`。

这些知识筛选、结构化呈现、可读性及不附自检题的要求应写入交给 pi 的写作说明，由 pi 负责正文。Codex 负责复用版式、绘制或放置图表、LaTeX 编译和逐页版面检查；绘图时核对图形是否忠实表达来源与正文。Codex 不自行改写 pi 的知识解释；学生指出正文“看不懂”或图文关系有误时，将具体内容问题交给 pi 修订，再由 Codex 更新图形和版面。笔记的表达问题不登记为学生薄弱点。只有学生独立表现提供证据时才记录掌握或错点。


### 第一份笔记与执行入口

新课没有既有版式时，使用清晰的中文字体、可读公式、稳定标题层级、充足页边距和上述按内容作用区分的视觉层级。先据课程材料确定必要的图表和例题，建立该课首份版式；不要等待旧课程模板，也不复制旧课程的内容或范围。此后沿用本课已接受的版式。

写作前读取本 Skill，将正文结构、文风、术语、图形和内容边界要求实际写入 pi 写作说明，并结合 COURSE.md 的输入与例外。Pi 只交知识文字与必要图形的文字说明；Codex 负责版式和实际图形，正文与用语问题交回 pi。

每份新笔记或用户要求的修订，按 本 Skill 的验收步骤 在写正文之前 prepare，逐页冷看后 accept，再运行 finish_work。检查只证明实际输入、作者和版面核验；不证明学生已读或掌握，也不把版面检查称为知识正确性核验。


## Lecture-note authoring and PDF delivery

For new notes and user-requested revisions of older notes, use the student-approved author/compiler division of work, while each
`COURSE.md` still controls taught scope, source priority, note organization and
exceptions. The local pi agent using DeepSeek V4.1 Flash writes the knowledge
prose; Codex prepares inputs, assembles the course's established LaTeX format,
compiles, and checks the rendered layout. Do not retroactively rewrite an
accepted note merely because this procedure changed; a user-requested quality audit may identify concrete revisions. For each current note and new delivery, use the shared role-based visual and wording checks in 本 Skill 的笔记标准. Record page-specific results and recheck each revision. Student reading and
independent practice remain separate evidence stages.

1. Codex identifies the actually taught boundary using the relevant course
   method and prepares an exact input bundle: official materials, usable
   transcript text when available, any course-required textbook excerpts, and
   a concise writing brief. Record what was supplied. If PDF extraction loses a
   diagram, formula or table that matters, provide a faithful readable rendering
   or description before sending the bundle; do not silently treat broken
   extraction as a complete source. Do not supply live graded work for AI
   answering. This is input preparation, not an audit of pi's finished prose.
2. Run **local `pi`** with provider `deepseek`, model ID
   `deepseek-v4-flash` (DeepSeek V4.1 Flash), and thinking `xhigh` specified
   explicitly. Verify the resulting pi session reports that actual model;
   an unrecognized ID can silently route to another model. Do not switch to Pro,
   another provider or a fallback model, and do not change the user's pi syncing
   settings. If the requested model is unavailable, retain the task and report
   the blocker. Give pi the relevant `COURSE.md` writing constraints and ask it
   to output **knowledge prose in LaTeX body syntax**, not a Markdown document,
   complete template, title/page styling, color boxes, figure environments, or
   TikZ drawing code. Pi owns explanation, model reasoning, examples, and the
   verbal specification of any necessary figure; Codex owns all visual
   hierarchy, figure construction, and page layout. Ask pi
   to omit self-test questions from formal notes. Keep raw output only while the
   note is being prepared or revised; remove it after the accepted PDF and
   material receipt are complete under the student's retention policy.
   A non-interactive invocation with already prepared text inputs is:

   ```bash
   pi --provider deepseek --model deepseek-v4-flash --thinking xhigh \
     --no-tools --no-context-files --print \
     --append-system-prompt "$(sed -n '/^## 跨项目文件写作默认规范/,$p' "$HOME/.pi/agent/AGENTS.md")" \
     @WRITING_BRIEF.md @SOURCE_EXTRACT.txt > PI_BODY.tex
   ```

   Replace the placeholder paths with this note's actual inputs; include
   additional source excerpts only when the course method calls for them.
   Preserve the pi session so its reported provider/model can be read back.
   `--no-context-files` disables automatic AGENTS.md loading. Explicitly
   append the writing-standard section from `~/.pi/agent/AGENTS.md`
   as shown above; verify that the section exists and is non-empty before
   invoking pi. Keep that section last in the global pi file so the extraction
   includes only the writing standard. Do not send merely a path or a summary
   of the rules. The course brief still controls source selection and required
   detail; clear language must retain necessary conditions and reasoning.
3. The pi brief must ask for natural, concrete Chinese with necessary English
   terms explained in context; motivation before definitions; every new symbol
   explained in words; model recognition cues, assumptions, limitations and
   likely confusions as the course requires. The brief must also give pi these
   **content-selection and structure instructions**:
   - Build the main line from the knowledge actually taught: concepts,
     definitions, relationships, mechanisms, conditions, distinctions and
     reasoning steps. Group them by meaningful topic rather than transcript
     order, slide order or the sequence of classroom anecdotes. Explain each
     point before using an example to illuminate it.
   - Keep the student-facing PDF limited to knowledge content and the model
     assumptions needed to understand it. Do not include scope or evidence
     statements, source provenance, received requests, transcript status,
     classroom progress, unresolved verification, or instructions meant for
     the assistant. Keep those records in COURSE.md or material receipts.
   - Include a classroom example, story or worked problem only when it helps
     explain a difficult point, distinguish similar ideas, show an application
     or boundary, or reflects clear teacher emphasis. Keep representative
     examples under the knowledge point they support and state what each
     illustrates. Combine redundant examples; omit passing anecdotes and
     digressions. For a necessary worked problem, show the intermediate steps.
     Do not treat every classroom mention as material to preserve.
   - Make each substantial module easy to review: use a clear topic heading,
     meaningful subheadings where needed, short connected paragraphs, and
     lists or tables for genuine steps or comparisons. Break up uninterrupted
     long prose without reducing explanations to isolated keywords or a wall
     of bullets. Do not give each slide, example or story its own top-level
     heading. Use no arbitrary page or paragraph-length target. For necessary
     figures, describe in words what must appear and what relationship the
     figure must teach; leave the drawing to Codex.
   Do not add self-test questions, closed-book output prompts or an end-of-note
   quiz to any formal note. Independent practice remains a separate student
   task using existing course questions within the taught scope. Have pi handle source coverage and factual
   uncertainty, including omissions or conflicting source text. These are
   writing instructions for pi, not a second content-review gate for Codex.
4. Before laying out a revision, identify the **same-course version the student
   accepted as the visual reference**; it may be an earlier edition rather than
   the latest generated draft. If it was overwritten, locate its saved PDF or
   recoverable backup before rebuilding the layout; do not recreate its style
   from memory. Inspect its first page and a representative body page. Codex
   inserts pi's knowledge text into that course's XeLaTeX
   style: fonts, margins, header/footer, main title and subtitle, section and
   subsection hierarchy, tables, figure captions, and the meaning of each box
   style. Compare the new render beside the reference at the same scale. Do not
   replace established title or heading formats with a new design just because
   the draft uses different markup. If the current course has no accepted
   template, establish one using the standards above; other courses need not
   share identical colors or categories. If pi outputs boxes, figure code or
   page styling despite the brief, extract its knowledge text and disregard
   those layout instructions. Codex chooses and builds actual figures, reuses
   clear source figures where suitable, and places complete examples according
   to their role. Do not use Pandoc's default layout. Codex
   may fix escaping, environments, package conflicts and line/page breaks for
   compilation, but must not independently rewrite or assert verification of
   pi's knowledge prose. Send a prose or explanation problem back to pi for a
   targeted revision; then make the figure and text agree.
5. Compile with XeLaTeX and an explicit temporary build directory. Leave only
   the verified student-facing PDF at the course delivery path after acceptance;
   remove this note's `.tex`, pi body, duplicate build PDF and sidecars (`.aux`,
   `.log`, `.fls`, `.fdb_latexmk`, `.out`, `.xdv`, `.synctex.gz`) after the material
   receipt is complete. An ongoing single master note may keep its current work
   source under `.study-system/active-note-sources/`. Inspect the
   compile log and visually render every PDF page for broken/missing glyphs,
   formula or table clipping, overflow, awkward blank pages, density and
   pagination. Inspect changed diagrams and title pages at normal reading
   size, and compare title levels and box roles with the accepted template.
   A successful compile alone does not prove the layout is usable;
   neither compile success nor visual review proves knowledge accuracy. The
   old `lecture_note_quality.py` includes semantic title/coverage heuristics and
   is not the acceptance gate for this pi-authored route. Record the actual
   compilation, page-layout, and source-to-figure checks in completion evidence
   and material receipts; do not describe them as verification of all prose.

If the student reports unclear wording or a substantive error, pass that
feedback to pi for revision and recompile the resulting LaTeX. Do not record a
student learning issue merely because the artifact is unclear. Actual student
answers, guesses, errors and retests still follow the ledger rules above.


## 写作前保存依据

将本 Skill 的正文和表达要求实际传入写作说明；正文之前保存该说明与课程版本，供最终核验，不另建要求文件：

```bash
python3 ../study-system/tools/delivery_review.py prepare .study-system/runtime/WORK --course COURSE --kind note --input .study-system/runtime/WORK/WRITING_BRIEF.md
```

改变写作依据时保留原记录，先重新准备再写修订正文。成品编译后按本 Skill 的笔记验收段检查；学生阅读与掌握仍由运行 Skill 按真实证据处理。

## 笔记验收与收尾

按本 Skill 的写作分工检查：读取实际写作说明和 pi 会话，确认实际输入、作者模型、文风和结构要求已传入。Codex 核验编译与版面，不把视觉检查称为知识正确性核验；正文或用语缺陷交回 pi 修订。

渲染最终 PDF，逐页检查字形、公式、图形、标题层级、主体与例题区分、裁切和留白。每页保存具体检查及修订复查结果；不适用的图形或内容类型说明理由。核对实际笔记路径及现有阅读任务承接，不推断学生已读或掌握。

工作目录中的 review.json 写入实际 artifact_sha256、page_count、pages（每页的 page、status=passed、summary），以及 checks：source_scope、layout、task_handoff、author_model、brief_standards。说明必须基于实际执行，不能填空泛“已检查”。有未修订页不验收。

```bash
python3 ../study-system/tools/delivery_review.py accept .study-system/runtime/WORK --artifact COURSE/notes/FINAL.pdf --receipt .study-system/evidence/RECEIPT.json --review .study-system/runtime/WORK/review.json
python3 ../study-system/tools/finish_work.py .study-system/runtime/WORK --artifact COURSE/notes/FINAL.pdf --receipt .study-system/evidence/RECEIPT.json
```

accept 将笔记制作依据及检查合并现有 JSON 回执。输入、课程或笔记规范改变、页码缺失、未通过页、成品哈希不符时保留工作。验收后再按运行 Skill 完成材料事件与学习承接；finish_work 清理专用临时目录。工具只核验记录、版本、字段与哈希，实际渲染和说明真实性由 Codex 负责。历史已接受笔记不追补。
