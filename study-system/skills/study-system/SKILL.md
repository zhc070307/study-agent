---
name: study-system
description: Operate the selected semester in the Codex-centred learning system. Use for “现在做什么”, weekly or daily study choices, course progress, new lecture/lab/tutorial files, recordings or transcripts, task completion, mistakes, blockers, retests, deadlines, and updates to COURSE.md, WEEK.md, or TODAY_WORKING.md.
---

# Study system

Work as the learning agent, not as an autonomous scheduler. The program stores
facts and renders views; learning judgments come from the current materials,
the relevant `COURSE.md`, the student's feedback, and discussion when needed.

From the project root, use:

```bash
../study-system/study
```

## Start every study operation

Lifecycle hooks remind you at session start/resume (including compact recovery),
each user prompt and meaningful state changes after shell/file edits. Perform
the semantic self-check before the substantive final answer. Stop requests at
most one fallback only for newly unresolved course state or newly claimed
materials without receipts; unchanged old issues and pending inbox items alone
do not restart a completed answer. These reminders are not authorization to broaden the task.
The pre-answer reminder is a semantic check of the actual conversation, even
if nothing changed in SQLite: catch feedback or agreed follow-up work you forgot
to record. Check only this turn's relevant course/system work; pure discussion
may need no writes. Perform the check quietly, fix omissions in scope, report
real blockers, then finish. Never respond to the reminder by endlessly checking
again or generating duplicate learning tasks. A user interruption must remain
an interruption; the next resumed session receives a recovery reminder.

1. If `TODAY_WORKING.md` exists, run `view sync --path TODAY_WORKING.md` first.
2. Run `context now --root . --date YYYY-MM-DD --out .study-system/runtime/context-now.json`.
   This loads the short global action memory, checks Calendar, scans course
   folders, and reports changes since the previous check.
3. Decide which course needs attention from Calendar, pending material events,
   the weekly pool, deadlines, and feedback. Then read that course's `COURSE.md`
   and only the materials needed for the decision.
4. Query raw historical evidence only when the current judgment needs it.
5. If `memory_maintenance.review_due` is true, review the action memory before
   finishing the operation, using the procedure below. No timer runs learning
   decisions unattended.

## 课程方法的形成与接续

Codex 先依据实际材料判断，再与学生沟通确定课程组织和学习方法。共享系统保留方法的执行经验；课程保存来源、选择、例外与当前状态。

## 初次接触或课程要求改变

1. 阅读 syllabus、评核要求、当前材料与可用样题。明确要独立完成的能力、正式义务、AI 边界及未知信息。材料可回答的问题先查材料。
2. 向学生提出具体学习建议，说明依据。无法判断或涉及重要取舍时，一次问一个问题，给出推荐答案，等待反馈。先确认目标和主要组织方式，再处理细节；不要要求学生逐条批准已有执行规范。
3. 在 COURSE.md 保存已经确定的目标、材料作用与优先级、组织方式、练习与检测方法、完成证据、复测触发和例外。尚未确认的事项写清未知或等待条件，不伪装为约定。可用自然语言，不新增方法配置或课程状态机。
4. 按当前范围复用任务，建立实际需要的材料处理、阅读、独立练习及正式义务。学习顺序不自动成为硬依赖；没有独立后果不拆任务。笔记需要持续承接，但重复内容可更新或复用，不要求每次课另发 PDF。

## 日常执行

先同步勾选并运行 context now；需要深入时运行 context course。按 COURSE.md 的来源和实际讲授范围选择方法。笔记读取 study-notes；选卷读取 study-worksheets 和学期 PRACTICE_SELECTION.md；概念检测使用 Skill 的持续检测流程。笔记和试卷各按自身 Skill 完成审查与收尾。

材料到达、授课范围改变、学生反馈或正式要求改变时，核对已有任务、已练能力与证据、剩余范围和等待条件。根据真实表现调整后续；重大方法改变先与学生商议。能力可组合，不按课程名称或学科标签强行套流程。

完成后双向核对 COURSE.md 与任务，登记实际反馈并读回证据，必要时更新周池与今日视图。纯方法讨论不制造学生任务；未知不等于弱点；不以解释、发卷、生成笔记推断掌握。

## 新学期

显式初始化独立账本并注册课程。注册后运行 `study course setup COURSE --root .` 创建按用途分类的课程目录及 COURSE.md 入口；该命令不替学生选择方法、不建学习任务，也不覆盖已有上下文。再分析材料并沟通填入真实约定；context now 会暴露已经登记但缺 COURSE.md 的课程。首次 COURSE.md 用上述沟通结果填写，不复制旧学期状态。选卷第一次需要时在学期 .study-system/PRACTICE_SELECTION.md 建立课程段，保留一份现行草案与紧凑历史。

结束旧学期时停用其自动化；新学期只为已经议定且需要定时执行的方法配置自动化，读取当前共享 Skill 和课程约定，不迁入旧任务身份或旧启动日期。

共享要求按职责读取：笔记使用 [study-notes](../study-notes/SKILL.md)，出卷使用 [study-worksheets](../study-worksheets/SKILL.md)，各自包含对应产物的审查与收尾。context now/course 返回对应入口。各课只补充实际来源、范围、方法选择和例外，不复制通用规范。

## Course context contract

Before editing a course context, run `course snapshot COURSE --root .`.
Use `course history COURSE` and `course restore SNAPSHOT_ID` to inspect or
recover earlier versions. `context course COURSE` provides the second-stage
course document, material paths and unresolved issues.

When the student specifies a whole-course map review date, save it with
`course map-review COURSE --on YYYY-MM-DD`. `context now` exposes due reviews
until handled. At that time, use `context course COURSE --inventory` and browse
the full live course structure, refresh the semantic map and source priorities,
then record `course map-reviewed COURSE --summary ...`. Do not mark the semantic
review done merely because the file scanner ran. Normal course context omits
the full inventory and historical evidence; open them only when needed.

`COURSE.md` is Codex's writable course context. Keep the material map and source
priority; the course system (assessment rules, future obligations, integrity
boundaries); the agreed goal and method; and current learning state (actual
teaching endpoint, mastery, weaknesses, blockers, and near-term attention).

Keep active course files grouped by use: `notes/` for student notes,
`materials/` for slides and Course Notes, `practice/` for Tutorial, Practice
Sets and self-assembled worksheets, and `assignments/` for graded work and Labs.
Do not create date folders. Order note filenames by the actual taught Topic
sequence; add a two-digit prefix where the existing course or Session numbering
does not sort them correctly. Continue a cross-session Topic in its existing
note. When moving a file, update its course context, open-task references and
SQLite material path before scanning; relocation is not a new learning event.

Codex may correct facts, material paths, progress, and completed state directly
when evidence is clear. Discuss consequential changes to the agreed goal or
method before making them durable. “What to do next” belongs in the task pool,
not as prose pretending to be a task in `COURSE.md`.

### Keep course state consistent with facts

Task changes, criterion progress, completion evidence, assessment results and
material receipts invalidate the course-state checkpoint. `context now` and
`context course` expose `state_sync.needs_review` and the changed fact groups.
After feedback, inspect the changed facts, update the current state (not a
chronological log), and run `course state-status COURSE --root .`. Acknowledge
the reviewed pair with `course state-reviewed COURSE --root . --ledger-hash HASH
--course-hash HASH --summary ...`. Hashes must come from the final, reviewed
document and facts; concurrent changes reject the acknowledgment. A factual
change with no effect on current learning state can be acknowledged with an
explicit reason without rewriting the document.

Review both directions: compare the relevant open task titles, descriptions
and unfinished criteria with COURSE.md and the changed evidence. Remove stale
requests to reconfirm completed work; preserve task identity and only the
remaining scope. A hash acknowledgment proves version alignment, not semantic
agreement. Do not acknowledge until this comparison is complete.

For courses with agreed topic-by-topic practice, maintain a short coverage
index in COURSE.md: each actually taught topic maps to an existing task,
specific completion/mastery evidence, or a concrete waiting/deferral reason
with a revisit condition. Start from the teaching scope, not only existing
table rows. Do not duplicate task status, priority, dates or exercise numbers;
resolve those from the ledger and source task. One task may cover many topics.
Check coverage when teaching scope changes, tasks are merged/deferred or
reprioritized, and before weekly/daily selection for the relevant course.
Normal companion practice must not silently become optional through an old
If Time label. Explain important omissions using current evidence. Unverified
exercise references require a concrete remaining action in the existing task,
not an indefinite footnote. A local passed retest does not cover a whole topic.
Do not build tables for unrelated courses or create future-topic tasks merely
to fill a template. The existing lifecycle self-check includes this check when
the turn affects topic coverage.

`today select` rejects stale course state; Stop also reminds about unreviewed
courses. A completed task need not mean mastery. Preserve raw evidence on demand,
and keep learning consequences in course state rather than action memory.

## Tasks and views

- Within the student's standing authorization, directly execute ready
  Codex work on the current checklist within its agreed scope. Do not leave it
  as a proposal awaiting another prompt. Keep genuine blockers and remaining
  stages visible; student reading/practice still requires student evidence.
- Arrange only the work supported by course agreements and the student's needs.
  Material processing, reading and independent practice have different evidence,
  but they do not impose an order on the student. The student may read first,
  practice directly, alternate, reuse existing work or request another approach.
  Do not automatically create a reading prerequisite, a new PDF or three tasks
  per class. Preserve existing task identities and record actual remaining work.
  The model must inspect materials and save truthful receipts; it must not claim
  that reading, practice or mastery occurred without the corresponding evidence.
- A real weakness, error, guess, unexplained result or retest need must never
  live only as a learning issue. Link it to an adequate open task or create a
  targeted task under the student's standing authorization for this rule.
  An explicit user-approved course exception takes precedence. If the course
  uses ledger-based retest retrieval, do not add per-issue task links or mastery
  gates on a completed detection task. Preserve issue evidence and retest dates;
  retrieve due issues under that course's method instead of duplicating tasks.
- Create durable work as an open task with criteria and a source. Put every
  actionable current-week task into `pool add`; ordinary tasks have no fake date.
- Use Must / Should / If Time according to the consequence of not finishing,
  not fixed quotas or invented duration estimates. Must means omission in the
  current planning horizon would create a serious assessment risk, compound a
  core learning gap, or block necessary downstream work. Should means the work
  has substantial learning value but a short deferral remains recoverable. If
  Time is enrichment or lower marginal value after the higher-consequence work.
- Weekly and daily selection is not deadline sorting. Start from the complete
  open inventory and genuine task prerequisites, then apply this
  order:
  1. Protect confirmed, irreversible official time constraints early enough to
     meet them: submissions, graded quizzes, exams, and prerequisites whose
     delay would make one of those commitments fail. An internal target date,
     review date, spacing window, or ordinary `due_at` is not automatically a
     hard deadline.
  2. For everything else, respect Must before Should before If Time. Within the
     same level, prefer the larger learning consequence: addressing a material, reading or practice gap according to the user’s needs; addressing evidenced
     weakness at a useful retest interval; unlocking downstream work or
     preventing gaps from compounding before the next class; and protecting a
     high-impact or demonstrably high-risk course. Recency, age, and ordinary
     dates are tie-breakers, not the primary selector.
  3. Audit the proposed selection across courses. Do not omit a course merely
     because none of its tasks has a near date, do not let note production crowd
     out student practice or mastery evidence, and do not force equal per-course
     quotas when consequences differ.
  4. When presenting the choice, state why the selected work wins and disclose
     any important ready work intentionally deferred. Never describe a list of
     near-due items as though it were the complete learning plan.
- Never infer how many study hours the student has in a day or how long a task
  will take. Calendar events identify immovable commitments, not a daily
  capacity estimate. Treat the daily list as an ordered action queue, not a
  claim that everything will fit. Normally include every ready Must and every
  ready Should with substantial learning value; do not shrink the list to a
  small guessed workload. If an important ready task is omitted, justify that
  from learning consequence or dependency state, never presumed lack of time.
  The student works down the queue and actual completion determines the next
  sync. Do not pre-assign ordinary study work to future dates: sync actual
  completion at the start of each day, then select from what remains. A requested
  future-day preview may show current priority relationships, but it must not
  move tasks out of today's queue or claim to be the final future plan.
- `today select --date ... TASK...` replaces the day's selection. Select after
  checking immovable Calendar commitments and changes since the last check;
  do not translate apparent gaps in the Calendar into assumed study capacity.
- Prefer work that can sensibly start today; do not hide weekday opportunities
  by preloading the weekend. Surface evidence-backed deadline or dependency
  conflicts, not guessed daily capacity.
- Generate `view backlog --date TODAY --out BACKLOG.md`,
  `view week --week MONDAY --out WEEK.md`, and
  `view working --date TODAY --out TODAY_WORKING.md` after changes.
  `TODAY_WORKING.md` is reserved for the current Hong Kong date; historical
  views and previews must use another filename. Verify its heading and queue
  after generation and immediately before opening it for the student.
- `BACKLOG.md` is the complete open-task inventory. `WEEK.md` and
  `TODAY_WORKING.md` are selections and must always disclose the total open,
  current-week and current-day counts so that a short view cannot imply that
  hidden work does not exist.
- Inside every course section in all three task views, split tasks first by
  actor: show `你要做的` before `Codex 要做的` (and keep external items separate
  if they exist). Within the student's section, order tasks by Must, Should,
  then If Time; in the complete backlog, put work outside the current week last.
- Never show task IDs in human-facing views. Preserve `【你】` / `【Codex】`.
- A half-finished task keeps its identity: update it to describe the remaining
  stage instead of closing it and inventing a duplicate.
- Treat every current-week audit as a separation of current action from stored
  future obligations. “All open records” includes future exams/submissions and
  tasks waiting for a class, release, material, or student decision; it is not
  automatically accumulated study debt. Put every currently executable task
  with material learning value into the current week pool regardless of guessed
  capacity. Keep an item outside only for a real trigger/waiting condition or an
  explicit student deferral, and state that condition. When new weekly work
  arrives, review old work for continued value, overlap, or consolidation so it
  does not roll forward mechanically.
- One user-facing task has one checkbox. Do not decompose its scope into nested
  mandatory checkbox items. Put chapter coverage, concepts, suggested steps,
  and verification hints in the task description and render them as plain,
  non-checkbox execution information. New tasks should normally have one
  outcome-level completion criterion. If work has genuinely independent
  consequences, create a separate real task; otherwise it remains explanatory
  scope. Existing detailed criteria may remain as internal scope history, but
  the working view must not present them as required subtasks; checking the top
  task represents completion of the whole task.
- Judge task nature by the agreed learning outcome and official consequence.
  When COURSE.md adopts consolidation worksheets, selected textbook/supplementary
  exercises and routine old-error retests share one continuing consolidation
  task per course. Do not keep parallel textbook and weakness checklists.
  Official Tutorial, Homework, Self-test and Programming Exercises retain
  their original files and independent evidence. A concrete blocker needing
  immediate practice may retain a separate action; record its result before
  choosing the next worksheet. Lecture and textbook reading retain their
  separate learning lines.
- Within one course and planning horizon, consolidate repeated work of the same
  nature when it has one completion consequence. Consecutive lecture-note page
  ranges may form one reading task, and several ordinary topic exercises may
  form one practice task. Keep genuinely different stages (material processing,
  student reading and independent practice), different actors, hard submissions,
  and real dependency gates separate. Preserve superseded task history instead
  of deleting it.
- Before `task create`, query open tasks for the same course, actor and stage,
  including dependencies and completion evidence. If new content extends the
  same reading, practice or diagnostic outcome, update the existing task's
  remaining scope and keep confirmed partial results as evidence. Lecture dates, chapter
  numbers, exercise numbers and issue count alone do not justify new checkboxes.
  When genuinely merging existing tasks, preserve their history and transfer
  any necessary dependency or completion meaning before superseding them.
  Do not combine work whose separate prerequisite or official consequence would
  make an otherwise ready action disappear. Reconcile this before weekly and
  daily selection, not only when a student points out duplicates. Never infer
  completion from receiving materials, attending class or doing a different exercise.
- When one continuing task contains ready earlier work and a later range still
  waiting for materials or reading, do not block the whole task on that later
  range. Keep the ready part selectable and state the local gate for the later
  part in its description. Select concrete exercises for newly taught topics
  from the course's agreed sources, with answers hidden until the student has
  tried them. A practice task only in blocked backlog does not provide daily
  follow-through for an already ready topic.
- Keep titles short and action-first. In the student-facing working view, prefer
  brief structured description lines such as `材料：`, `范围：`, `暂不包含：`,
  `要求：`, `完成标准：` and `阻碍：`. Do not mix a book or file name, page range,
  detailed method, history and completion rule into one prose paragraph.

## Material events

### Material-event handling

Use the exact file path and course. Cross-check the material against the
course's source hierarchy, nearby files from the same session, Calendar, and
official textual requirements when present. Never infer that an entire slide
deck was taught merely because the class time passed.

A `calendar_ended` event establishes only that the planned time has passed.
Look for corroborating material or user feedback before saying attendance or
teaching occurred. If evidence is missing, record the uncertainty and release
the event with the missing input; do not invent a teaching endpoint.

For an ordinary new or changed file:

1. inspect actual contents, then use `material classify EVENT --kind TYPE --reason REASON` to record the type; use `--session SESSION` only after confirming the relationship. New files remain `other`; filenames, extensions and dates do not classify or bundle them;
2. update the `COURSE.md` material map;
3. update current state only for facts the evidence supports;
4. inspect explicit deadlines, submissions and assessment requirements;
5. create official obligations directly; discuss optional self-study work;
6. close the event with a truthful receipt.

When creating an official obligation, use `task create --origin-key` with a
stable key such as `COURSE:assignment:submission`, independent of the scan/event
version. Retrying the same requirement returns its existing task. Update that
task when the official requirement changes; do not create a duplicate.

For a recording plus transcript, treat both as one session bundle. Register the
recording but do not replay it. Once the transcript is
available, read the transcript, slides and relevant official sources; write the
required Lecture Notes; update the material map and course state; check explicit
requirements; reconcile tasks; then close the transcript event with
`--lecture-notes`, all three review flags, and a precise `--task-effect`.
If the user/course explicitly permits judging note necessity and the content
does not warrant new notes, use `--notes-not-required REASON` instead of
`--lecture-notes`. Record the reviewed scope, reuse decision and actual task
effects. All three review flags remain required. Never attach a fake artifact
to bypass the receipt requirement.
Use repeatable `--related-event RECORDING_EVENT_ID` to close explicitly inspected
recordings in that same session atomically with the transcript. Do not blindly
bundle all files sharing a date: one day can contain a lecture and a lab.

After the actual scope is recorded, the accepted PDF is verified, downstream
tasks are reconciled, and receipts are closed, remove the processed recording,
transcript, superseded PDFs, LaTeX source and build intermediates from the
course folders under the agreed artifact retention policy. Keep material
still needed for an unresolved session until its processing is complete.
`material inspect` includes existing session receipts; reuse their work when
the same input was already processed, while checking genuinely new versions.

Do not close an event by saying only “seen”. If no task is needed, state why in
the task-effect receipt. If no transcript will exist, use the best available
evidence and state the limitation in `COURSE.md`.

## Feedback

### Course-agreed consolidation worksheets

Use [study-worksheets](../study-worksheets/SKILL.md) for preparation,
selection, question limits, source checks, deduplication and acceptance. It is the
shared execution standard. COURSE.md controls adoption, sources, cadence,
language, grading and explicit exceptions; PRACTICE_SELECTION.md keeps this
semester's actual plan and issue history. Do not copy old course identities,
source choices, start dates or timing into a new semester.

Record completion, scores, files, and observed errors as facts. Update
`COURSE.md` when feedback changes future learning judgment. When a weakness or
missing activity implies more work, propose it to the student, then put the
agreed task in the current week pool. Routine follow-up already authorized by
the course method or the standing weakness/retest rule above does not need
reconfirmation: reuse an adequate task or record the remaining action directly.
A passed retest changes an issue's current status but never deletes, overwrites,
or hides its original error evidence. Midterm, final and other cumulative review
must be able to retrieve both pending issues and passed historical issues.
Only work beyond that authorization or a consequential method change needs new
discussion. Explanation alone does not prove mastery; use independent work or
a retest.

### Course-agreed continuing concept MC practice

Apply this flow only when COURSE.md adopts conversation-based concept
multiple-choice practice; use that course’s language and source requirements. This is a separate concept diagnostic stage from official
practice, calculations, modelling and submissions. Do not apply the worksheet
cadence or generate a scheduled quota of MC papers.

1. After relevant material/read-progress updates, before week/day selection,
   and when the student asks to practise, read COURSE.md, the current concept
   task, prior attempts and learning_issues. Reuse one continuing concept task
   for the active course line; add newly eligible scope without reopening
   completed ordinary questions. Preserve explicit deferrals and local gates.
   Preserve the course’s explicit examination-stage trigger.
2. Determine eligible scope and gaps from current COURSE.md before writing.
   Use its approved sources and textbook status. Reading is not a hard gate
   unless the student subsequently changes that agreement. Stable concepts
   need no mechanical repetition; retest findings at the course-agreed window.
   Do not replace or delay official practice with concept questions.
3. Generate questions when the student is ready to answer, not in advance.
   Continue any already issued unanswered set. Mix conceptual distinctions,
   conditions and business/policy situations without naming the tested method.
   Prefer existing non-graded questions where suitable; otherwise generate
   source-grounded conceptual variants. Check each answer and source internally
   before issue, keep the key hidden, and use placeholders for format examples.
   No mandatory calculations, drawings or written explanations for this MC
   flow; no fixed item count, pass score or claimed exam-difficulty calibration.
4. Receive independent answers and uncertainty/vocabulary marks, then reveal
   the key and score valid questions. Identify concept confusion, vocabulary
   misreading and guesses without inventing causes. Revise/exclude ambiguous
   items from the score and student weakness record. Correct but uncertain
   answers remain unconfirmed; explanations alone do not establish mastery.
5. Record each attempt with its actual source/scope, valid score, original
   answers and uncertainty marks through assessment record. Store confirmed
   findings in learning_issues; reuse issues for repeat occurrences. Record
   retests against the original issue and preserve first-attempt history.
   Read back evidence and issue records before claiming they were saved.
6. Update COURSE.md's covered/unstable/waiting scope and the existing concept
   task's remaining action. Use targeted rereading and unseen-context MC for
   demonstrated gaps at the agreed trigger, without one task per issue.
   A completed set is completed attempt evidence; unfinished sets continue.
   Close the current task only when its eligible scope has been answered and
   marked and remaining findings have an explicit follow-up/waiting condition.
   Reopen the same task when new scope becomes eligible. Reconcile course state,
   week/day queue and generated views; no completion or mastery from issuing.

### Conversation findings: record first, then link action

For each concrete error, guess, inability to explain/start, or explicitly reported
unstable concept in this turn, query the relevant course's learning_issues and
assessment evidence first. Reuse the existing issue when it is the same finding;
record a new occurrence/evidence without duplicating the issue. New confirmed
findings must be saved through `assessment record` with `--issue`, a factual
`--summary` and an honest `--evidence-ref` (actual file or dated conversation
reference). Unknown causes stay unknown. A question alone is not proof of a
weakness; ordinary knowledge explanations belong in the existing notes, while
unresolved questions follow the course's agreed method.

Before finishing, read back the relevant issue and source assessment and match
them against the turn's findings. A task description, COURSE.md mention, command
success, or Hook receipt alone is not proof that the finding was saved in the
issue ledger. Check both the stored evidence and the adequate remaining action.
If a write fails, preserve the finding and report the blocker; do not say saved.
This is a semantic check, not a claim that Hooks can detect every omission.

User-facing descriptions are concise execution instructions. Rewrite the whole
description when feedback changes it; do not append another narrative paragraph.
Omit completed-work history, migration history, repeated mastery disclaimers and
instructions to Codex about reading/writing the ledger. Keep necessary scope,
material locations, real deadlines and completion requirements. Before delivery,
read the regenerated visible checklist, not only the database diff, and remove
text that does not help the student execute or choose the task. Do not truncate
by character count or hide task scope to make the list short.

Task descriptions contain the remaining action, necessary scope/source and
completion standard. Keep only a short topic cue for the linked issue; do not
append original answers, diagnosis history, full explanations or repeated
feedback. Retrieve these from learning_issues and its assessment evidence.
Before shortening a legacy description, verify those facts already exist in the
ledger; migrate supported missing facts first. Preserve practice coverage,
independent-work rules, dependencies and retest windows. Do not create one new
task per issue when an existing task adequately covers several findings.

## Learning artifact routes

Use [study-notes](../study-notes/SKILL.md) for note writing, layout and note
acceptance. Use [study-worksheets](../study-worksheets/SKILL.md) for question
selection, compilation and worksheet verification. Each owns its complete
workflow and review criteria. Only file hashing, receipt storage and temporary
work cleanup are reusable mechanics; do not create a unified review policy.

## Global action memory

`.study-system/AGENT_MEMORY.md` remembers recent whole-system operations,
cross-course follow-ups, and unusual operational context. It is not course
memory and not a duplicate task list. Keep recent entries detailed. Once an
entry is over a week old, compress or delete it confidently if its consequence
already exists as a task, course state, event receipt, or database checkpoint.

`context now` and lifecycle Hooks read a separate semantic-compaction
checkpoint. Review is due after seven days or above 6000 characters; an ordinary
save does not postpone it. Old installations without an explicit compaction
checkpoint are due immediately. The reminder persists on subsequent prompts
until compaction is recorded, while Stop retains its existing no-loop behavior.
The limit is a ceiling, not a writing target.

For routine additions, run `memory rewrite --root . --from-file DRAFT
--expected-hash HASH`. For actual semantic consolidation, read `memory status`,
review the current memory against relevant tasks/receipts/course state, prepare
a concise draft, and run `memory compact --root . --from-file DRAFT
--expected-hash HASH --summary ...`. The summary must state what was removed,
combined or retained and why. Only compact resets the seven-day review clock.
Neither a short draft nor a command receipt proves semantic quality.

Organize action memory as pending system follow-ups, recent operational changes,
and a brief older history. Remove repeated Skill rules and dated course progress
already represented in COURSE.md or the ledger. Retain unresolved actions and
recovery triggers even when old. Do not summarize course goals/methods as part
of this process. Backups preserve original history without being loaded into
normal context.

SessionStart and context now perform backup maintenance at most once per Hong
Kong day. `backup --maintain --root .` forces a repair/rotation pass. Snapshots
use portable relative references, retain their IDs and share identical content.
Version bodies are archived during daily maintenance, without a seven-day
loose-file shelf. Historical versions remain accessible in
hash-checked ZIP archives under `.study-system/backups/archives/`. Archive
publication and byte verification precede removal of loose originals. Restore
reads loose and archived versions and targets the current course folder.
Use `memory restore --root . --backup REF --expected-hash HASH` to recover an
action-memory version without marking it as a semantic review. Historical facts
remain available on demand.

## 练习启动与阅读进度

默认不设置“先读对应笔记，再做专题练习”的硬性前置。已讲范围且题面齐备的练习、概念检测及自组卷选题，不以笔记或教材阅读完成为前置；可直接独立作答，按表现补读。阅读任务保留自身进度，不阻塞练习。实际讲授范围、材料条件、考试阶段和学生明确暂缓仍有效；历史阅读确认不变。

## Finish artifact work

正式文件交付前，在 macOS 上检查最终文件的 `st_flags`。若带
`UF_HIDDEN`，只清除该隐藏标志，并确认清除前后内容哈希一致。
检查最终交付路径，不以临时构建文件的属性代替；内部点名文件和
`.study-system` 等系统目录保留原属性。

Use a dedicated `.study-system/runtime/<work>` directory for each build. Store
final artifacts at the course delivery path and short receipts directly in
`.study-system/evidence/`. Do not retain new render images, extraction copies,
compiler logs or draft bodies as long-term references. Reuse textbook indexes.
After visual/source checks required by the workflow and the material receipt
are complete, run:

```bash
python3 ../study-system/tools/finish_work.py .study-system/runtime/<work> --artifact <final-path> --receipt .study-system/evidence/<receipt>
```

This moves the completed work folder to Trash, verifies the persistent artifact
and receipt exist, and rejects the runtime root or receipts still in runtime.
SessionStart retries cleanup interrupted after its completion marker was saved.
Do not mark unfinished/failed work finished. Keep required recovery files and
record the remaining stage; do not substitute a timer for completion evidence.
Legacy receipts already cited by historical ledger entries may stay at their
original paths. New receipts use evidence. Do not rewrite immutable history just
to tidy paths. Current COURSE.md states current facts; condense redundant dated
operation logs when updating the relevant course, preserving source boundaries,
student decisions and original evidence in the ledger/snapshots.

## Semester directory boundary

Read the selected semester's `.study-system/STUDY_SYSTEM.md` when present for
local operation agreements; shared execution does not require copying an old
semester guide and `.study-system/PRACTICE_SELECTION.md` when selecting worksheets.
Keep top-level files limited to AGENTS.md and the current daily/week/backlog
views, plus course folders. Do not recreate root STUDY_SYSTEM.md,
PRACTICE_SELECTION.md, tmp/, .agents/ or local program copies. Program files and
Skill belong to the shared program directory selected in .study-workspace.json.
Evidence and recovery data belong to the selected semester's .study-system/.
Historical migration/workflow reports are archived, not current instructions.

Keep the semester backup directory compact: one current `backups/latest.sqlite3`
restore point and fixed `backups/archives/` containers. Reuse existing containers
for historical material; do not leave a new manual folder or a loose copy for
every operation. Preserve original student evidence and only the current source
of an ongoing master note. Empty cache/log shells are not durable records.

## 规范归属

共享要求只在study-system、study-notes、study-worksheets 三个职责明确的 Skill 维护。README 只作入口说明，Hook 和自动化只提醒、引用执行入口，不维护第二份详细规范。COURSE.md 保存本课方法选择、来源、范围、例外与当前状态；任务只保存行动、简短主题、材料、剩余范围和完成标准。回执是实际执行证据，不是新要求文件。新经验先更新已有对应段落，不按任务、日期或课程新增通用要求文件。
