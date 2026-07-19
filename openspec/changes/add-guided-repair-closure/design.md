## Context
待答任务已经随 `teaching_sessions.session_json` 持久化。逐步错因定位会把错误后的任务降为 `diagnostic_check`，因此现有掌握证据门禁会拒绝它，这是正确的；但任务对象没有保存原题，独立判卷也只处理 `knowledge_check` 和 `practice`，造成纠错后的恢复缺口。

## Goals / Non-Goals
- Goals: 独立核对局部修正；保存并恢复原题；严格区分局部修正、提示后完成原题和无提示复查；重启可恢复；错误时继续缩小而不丢原题。
- Non-Goals: 不把局部修正计为掌握；不要求一次局部修正后立即完成整节课；不让客户端自行生成学科题目答案；不在界面显示隐藏评分契约或纠错状态 JSON。

## Decisions
- Decision: 在规范化待答任务中增加 `repairContext`，字段包括稳定 `id`、`stage`、规范化 `originalTask`、最初与最新错误片段、修正原则、已成立片段和尝试次数。
- Decision: `stage` 仅允许 `repair_step` 与 `retry_original`。局部修正任务保持 `diagnostic_check`，但 `shouldVerifyStudentAnswer` 对带 `repairContext` 的真实作答例外调用独立判卷。
- Decision: 局部修正的隐藏评分依据来自任务提示、修正原则和原任务上下文；即使判卷正确，`studentStateUpdateFromVerification` 也必须因证据范围为 diagnosis 返回 null。
- Decision: `repair_step` 正确后由客户端把 `originalTask` 恢复为当前任务，保留其隐藏评分契约，设置 `supportContext=scaffolded` 并把阶段改为 `retry_original`。
- Decision: `retry_original` 正确后当前回合不留下第二个任务；客户端安排 `independent_recheck` 自动续讲，由教师生成一道新的无提示同构题。此前正向更新只标为 prompted，不解除干预。
- Decision: 任何纠错阶段再次错误时，使用新判卷定位生成新的 `repair_step`，`originalTask` 和稳定 id 不变，attempts 增加。
- Decision: 不扩展数据库 schema；现有会话 JSON 的深拷贝与合并路径自然保留新增字段。

## Risks / Trade-offs
- 纠错回合增加额外判卷调用 -> 只对带纠错上下文的真实回答执行，保证状态转换有可信依据。
- 自动恢复原题可能让学生感觉重复 -> 可见反馈明确说明只需从已保留步骤继续，并把原任务标记为提示后路径。
- 连续纠错可能循环 -> attempts 进入上下文；同类错误由现有干预状态机在第二次换表示、第三次退回前置知识。
- 旧会话没有 repairContext -> 保持现有保守行为，不猜造原题。

## Migration Plan
1. 新生成的局部修正任务写入 repairContext；旧 `diagnostic_check` 继续由主教师保守处理。
2. 规范化器读取并限制新增字段，非法或过大的上下文直接丢弃。
3. 回滚时旧客户端忽略 repairContext，原会话仍可读取基础任务字段。

## Open Questions
- 无。当前闭环以一次局部修正、一次原题恢复和一次无提示同构复查为最小可靠路径。

