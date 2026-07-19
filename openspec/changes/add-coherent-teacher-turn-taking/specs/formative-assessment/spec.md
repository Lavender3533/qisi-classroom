## ADDED Requirements

### Requirement: 待答任务证据隔离
系统 MUST 由客户端根据待答任务类型决定学生回答可用于掌握度、错因诊断或仅用于课堂调节，模型不得自行扩大证据范围。

#### Scenario: 回答知识检查或练习
- **WHEN** 学生回答 `knowledge_check` 或提交 `practice` 且回复提供可验证学科证据
- **THEN** 系统允许经过现有证据校验的掌握度与诊断更新

#### Scenario: 回答诊断检查
- **WHEN** 学生回答 `diagnostic_check`
- **THEN** 系统允许形成逐字引用证据的错因诊断，但不得提高或降低掌握度

#### Scenario: 回答学习选择或确认
- **WHEN** 学生回答 `learning_choice`、`readiness` 或 `none` 类型任务
- **THEN** 系统拒绝掌握度和错因诊断更新，也不得推进课时步骤

#### Scenario: 学生显式打断待答任务
- **WHEN** 学生转而提出问题、表示不会或请求课堂总结
- **THEN** 教师按新的显式意图回应，同时旧任务不得使本轮产生不相关的掌握证据
