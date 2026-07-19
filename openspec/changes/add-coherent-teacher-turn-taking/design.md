## Context
教师回合目前有 `teacher_move`、`intent` 和自然语言 `checkpoint`，但没有机器可判定的“学生下一轮在回答什么”。模型可以生成学科内容，客户端却无法可靠限制证据更新，也无法保证主动提醒仍围绕同一任务。

## Goals / Non-Goals
- Goals: 让教师跨回合记住待答任务；隔离学习选择与学科证据；处理学生犹豫、求答案和节奏请求；防止连续问题覆盖。
- Non-Goals: 推断学生人格或情绪；引入长期心理画像；阻止学生临时提问或改变学习目标。

## Decisions
- Decision: 教师结构化输出新增 `student_task`，类型限定为 `knowledge_check`、`practice`、`diagnostic_check`、`learning_choice`、`readiness`、`none`。
- Decision: 客户端根据任务类型决定证据范围，忽略模型自行声明的证据资格。`knowledge_check` 与 `practice` 可形成掌握证据，`diagnostic_check` 只可形成诊断证据，其余类型均不可更新学情。
- Decision: 模型缺失 `student_task` 时根据教师动作和 checkpoint 生成保守的兼容任务；旧会话缺失待答任务时维持现有证据路径，仅从新教师回合开始建立契约。
- Decision: 学生显式提问、表示不会或请求总结可以打断待答任务；普通短回答则按待答任务解释。
- Decision: 主动提醒使用专门的 `checkpoint_reminder` 续讲类型，保留原任务对象并禁止新问题。

## Risks / Trade-offs
- 任务类型过于严格可能丢弃有效证据 -> 只对明确存在的新任务契约启用严格门控，旧会话保持兼容。
- 模型给出的任务字段不完整 -> 客户端归一化并从 teacher move、checkpoint 和当前知识点派生。
- 学生回答既包含节奏请求又包含答案 -> 显式节奏请求优先保护学情，教师下一轮先调整节奏并重新给一个可检查任务。

## Migration Plan
无需数据库迁移。`pendingStudentTask` 保存到现有 `teaching_sessions.session_json`；旧会话首次收到新教师回复后自动获得该字段。

