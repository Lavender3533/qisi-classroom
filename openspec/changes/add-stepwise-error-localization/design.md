## Context
主教师当前会输出 `learning_diagnosis`，客户端只校验 `evidence_quote` 是否来自学生消息。独立判卷更可信，但只返回整体 verdict、reason 和 feedback，具体错因仍可能由主教师猜测。多步骤答案中，一个最终错误并不等于整套方法错误；真实教师应先确认正确前缀，再定位最早失效的步骤。

## Goals / Non-Goals
- Goals: 让错误定位有逐字证据；区分正确前缀与第一处错误；让补救只针对一个可观察卡点；在无法定位时安全降级。
- Non-Goals: 不要求模型公开内部思维链；不保存判卷器的隐藏推理；不把一次错误诊断成人格、能力或固定学习风格；不对所有纯最终答案伪造中间过程。

## Decisions
- Decision: 在判卷结果中增加 `verified_part_excerpt`、`first_error_excerpt`、`error_category`、`correction_focus`。这些是简短结论与原文引用，不是模型内部推理。
- Decision: `first_error_excerpt` 对可信 `incorrect` 必填且必须逐字来自本轮作答；多步骤答案有正确前缀时 `verified_part_excerpt` 也必须逐字来自本轮作答且首次出现位置早于错误片段。
- Decision: 错误类型使用受限枚举 `concept_confusion`、`procedure_gap`、`syntax_error`、`execution_error`、`careless_error`、`prerequisite_gap`、`unknown`，与现有干预状态机兼容。
- Decision: 只有最终短答案时允许 `verified_part_excerpt` 为空，`first_error_excerpt` 使用该答案原文，错误类型默认 `unknown`，不得虚构学生未写出的过程。
- Decision: 客户端从可信定位构造 `learning_diagnosis`。主教师自报诊断仅在没有可信独立定位时进入现有保守校验路径。
- Decision: 可见反馈若没有引用第一处错误，客户端增加一个简短定位前缀；下一任务仍由教师生成，但必须与 `correction_focus` 对齐，否则降级为只辨析该原则的最小任务。

## Risks / Trade-offs
- 判卷 JSON 更复杂，模型可能漏字段 -> 严格规范化；整体 verdict 可保留，但无有效定位时不生成具体错因。
- 同一句学生原文可能重复出现 -> 使用首次位置进行保守顺序判断；无法稳定判断时不声称存在正确前缀。
- 客户端纠正可能使反馈略显模板化 -> 只在主教师遗漏定位或任务偏离时介入，正常优质回复保持原样。
- 错误类型仍可能不确定 -> 允许 `unknown`，优先保证引用和修正原则可靠，不强迫细分类。

## Migration Plan
1. 判卷器开始输出新字段；旧响应缺字段时沿用整体判卷但不产生权威具体错因。
2. 客户端优先采用可信定位；旧课堂会话和旧学习事件无需迁移。
3. 若新字段验证失败，课堂继续并给更小检查，不写入具体错因。

## Open Questions
- 无。先以可验证的第一处错误为目标，不扩展到完整思维链评分。

