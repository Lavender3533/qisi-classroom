## ADDED Requirements

### Requirement: 有依据的错因诊断
系统 MUST 将错因诊断限制为概念混淆、步骤遗漏、语法错误、执行追踪困难、粗心、前置知识缺口、提示依赖或待诊断，并要求诊断引用学生本轮消息中的原始片段。

#### Scenario: 诊断具有原始证据
- **WHEN** 模型返回错因诊断
- **THEN** 客户端 SHALL 验证 `evidence_quote` 逐字出现在学生本轮消息中
- **AND** 只有通过验证的诊断 SHALL 驱动后续干预

#### Scenario: 错误无法可靠归因
- **WHEN** 作答只证明结果错误而不能证明具体错因
- **THEN** 系统 SHALL 将其标记为待诊断并提出一个能区分错因的低负担检查
- **AND** SHALL NOT 默认标记为概念混淆

