## ADDED Requirements

### Requirement: 热身证据与主课进度隔离
系统 MUST 允许热身答案更新对应知识画像，但 MUST NOT 使用该证据推进当前新课步骤。

#### Scenario: 热身答案正确
- **WHEN** 热身答案产生正向掌握证据
- **THEN** 系统 SHALL 更新被复习知识点的画像
- **AND** SHALL NOT 改变当前 lessonProgress.currentStep

#### Scenario: 热身答案错误或不会
- **WHEN** 热身回答产生负向证据或学生明确表示不会
- **THEN** 系统 SHALL 进入该知识点的针对补救并保持主课步骤不变
- **AND** 只有后续独立正确证据解除补救后 SHALL 恢复主课

