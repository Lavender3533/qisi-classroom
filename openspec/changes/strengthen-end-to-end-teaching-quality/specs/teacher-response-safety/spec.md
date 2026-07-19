## ADDED Requirements

### Requirement: 内部教师协议不得作为正文显示
系统 MUST 从合法或可有限修复的结构化教师输出中只展示学生可见消息，并在无法解析时隐藏疑似协议内容。

#### Scenario: JSON 被前后文本或围栏包裹
- **WHEN** 模型返回围栏 JSON 或 JSON 前后包含简短说明
- **THEN** 系统 SHALL 提取结构化回合并只显示 `message`

#### Scenario: JSON 包含尾随逗号或智能引号
- **WHEN** 输出仅存在可确定修复的尾随逗号或键名智能引号
- **THEN** 系统 SHALL 在校验必要字段后使用修复结果

#### Scenario: 疑似协议无法解析
- **WHEN** 输出包含 `teacher_move`、`student_task` 或 `student_state_update` 等内部字段但无法安全解析
- **THEN** 系统 SHALL 显示可重试的安全提示
- **AND** SHALL NOT 显示原始字段或据此更新学情
