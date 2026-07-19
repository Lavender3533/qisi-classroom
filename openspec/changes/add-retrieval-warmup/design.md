## Context
复习调度和课堂状态已经存在，但二者没有编排连接。热身需要临时改变教师焦点，同时保持当前 lessonProgress 不动，并在完成后恢复主课。

## Goals / Non-Goals
- Goals: 老师主动执行到期检索；热身证据与主课进度隔离；错误时可补救；完成后自动回主课；重启不重复。
- Non-Goals: 每次开课都强制复习；一次热身覆盖多个知识点；用热身替代正式复习模块。

## Decisions
- Decision: 只有具有有效 `last_reviewed` 且距今至少 12 小时的 due 项可触发热身，避免刚摸底完就被重复提问。
- Decision: 热身状态保存到现有 teaching session JSON，不新增数据库表。
- Decision: 教师简报在 awaiting_response 时进入“检索热身”，在错误补救时由 activeIntervention 接管。
- Decision: 热身期间 student_state_update 可更新知识画像，但传给 updateLessonProgress 的证据必须为 null。
- Decision: 完成热身后使用去重的内部续讲 `resume_after_review` 主动恢复当前教案。

## Risks / Trade-offs
- 模型没有返回有效学情证据 -> 保持 awaiting_response，不擅自判定热身完成。
- 热身答错 -> 进入当前知识点补救，只有独立正确证据解除后才回主课。
- 应用在等待回答时重启 -> 恢复同一教师问题和 awaiting_response 状态，不重新生成题目。

