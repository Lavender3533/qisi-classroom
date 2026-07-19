## Context
现有 `learning_events` 已能保存任意结构化事件，`teaching_sessions.session_json` 也能保存会话偏好，因此无需新增表。关键问题是建立保守的归因规则，避免把一次偶然作答过度解释为固定学习风格。

## Goals / Non-Goals
- Goals: 记住学生明确的节奏请求；用后续独立证据评估教学策略；跨课时复用有效教法并避免连续失败策略；向学生透明展示。
- Non-Goals: 诊断人格、智力、情绪或所谓固定“学习风格”；根据一次偏好永久限制教学方式；保存完整私密对话作为画像。

## Decisions
- Decision: 显式节奏请求同时写入会话 `teachingPreferences` 和 `teaching_preference` 学习事件，当前课堂立即生效且可跨课时恢复。
- Decision: 学生回答只归因到它正在回应的上一待答任务；问题、学习选择、犹豫和未验证回合不计算策略成败。
- Decision: 独立正向证据记为 `independent_success`，提示后正向证据记为 `prompted_success`，负向证据或明确卡住记为 `difficulty`。
- Decision: 至少一个独立成功可列为“已有有效证据”；至少两次困难且没有独立成功才列为“避免重复”。
- Decision: 使用现有学习事件聚合策略记忆，不新增数据库迁移。

## Risks / Trade-offs
- 少量证据可能过拟合 -> 暴露证据次数，并只把重复失败列为避免项。
- 当前教学策略名称过于粗 -> 优先使用干预策略，缺失时回退到 teacher move 对应的稳定策略类别。
- 学生改变节奏偏好 -> 使用最近一次显式请求覆盖当前值，历史事件仍保留审计证据。

## Migration Plan
旧数据没有教学策略事件时返回空记忆并维持现有教法。新事件产生后自动进入学习画像，无需迁移。

