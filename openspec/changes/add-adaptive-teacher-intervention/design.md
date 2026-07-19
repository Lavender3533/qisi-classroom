## Context
大模型可以生成高质量学科解释，但不能独自拥有课堂状态。当前客户端只持久化课时步骤和尝试次数，缺少跨回合干预状态，导致模型知道学生答错却不知道上次已经用过什么教法。

## Goals / Non-Goals
- Goals: 用学生本轮证据形成可验证错因；让错因确定干预策略；让重复失败触发升级；让干预只由独立正确证据解除。
- Non-Goals: 用规则替代学科解释；根据一次错误诊断人格、能力或情绪；自动降低整门课程难度。

## Decisions
- Decision: 模型提出诊断，客户端要求 `evidence_quote` 必须逐字出现在学生本轮消息中，否则降级为 `unknown`。
- Decision: 客户端而不是模型决定干预策略和升级级别，避免模型连续重复同一种提示。
- Decision: 干预状态保存在现有 `teaching_sessions.session_json`，不新增数据库表或迁移。
- Decision: 正向证据分为 prompted 与 independent；prompted 保持干预并安排无提示再检查，independent 才解除同知识点干预。

## Risks / Trade-offs
- 学生回答很短，无法可靠归因 -> 使用 `unknown` 并先问一个有区分度的小问题，不强行贴错因标签。
- 模型给出正确解释但诊断字段无效 -> 正文仍可展示，但不持久化未经证实的诊断。
- 历史课堂没有干预字段 -> 归一化函数对缺失状态返回空，保持向后兼容。

## Migration Plan
无需数据库迁移。旧会话首次产生有效错误证据后才创建 `activeIntervention`；独立正确证据或课时完成后清除。

