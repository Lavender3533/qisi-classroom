# Change: 增加引导纠错闭环

## Why
系统已经能定位学生作答中的第一处错误并给出一个最小修正任务，但当前修正任务会替换原待答任务，且 `diagnostic_check` 不进入独立判卷。学生修正后，是否回到原题、是否承认提示依赖、是否安排无提示复查仍依赖主教师临场生成，可能停在局部步骤、丢失原题或把提示后成功误记为掌握。

## What Changes
- 最小修正任务携带不向学生展示的纠错上下文，包括原任务、第一处错误、修正原则、阶段与尝试次数。
- 学生对最小修正任务的回答也由隔离判卷器核对，但该回合只形成诊断证据，禁止更新掌握度或推进教案。
- 单步修正正确后，客户端恢复原任务并明确保留之前已成立的部分；恢复后的原任务标记为提示后完成路径。
- 恢复后的原任务正确时，教师自动安排一道无提示同构复查；只有该复查的独立正确证据才能解除干预并恢复教案推进。
- 单步修正仍错误时继续锁定新的第一处错误，保留原任务且累计纠错次数，不从头重启课堂。
- 纠错上下文随课堂会话持久化，应用重启后可以继续当前阶段。

## Impact
- Affected specs: `guided-repair-closure`
- Affected code: `frontend/answer-verifier.js`, `frontend/teacher-engine.js`, `frontend/app.js`, `tests/answer-verifier.test.mjs`, `tests/teacher-engine.test.mjs`, `tests/real-repair-closure-eval.mjs`
- API: 复用现有 `verify_student_answer` 和流式教师命令，不新增原生命令。
- Persistence: 扩展现有 `pendingStudentTask` JSON，不新增数据库表。

