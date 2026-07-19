## ADDED Requirements

### Requirement: 局部修正任务保留原任务
系统 MUST 在第一处错误后的局部修正任务中保存不向学生展示的原任务快照、纠错阶段、错误证据、修正原则和尝试次数。

#### Scenario: 第一次生成局部修正任务
- **WHEN** 独立判卷可信定位学生原任务中的第一处错误
- **THEN** 新任务 SHALL 保存原任务提示、期望格式、知识点和隐藏评分契约
- **AND** 学生界面 SHALL 只显示当前一个局部修正动作

#### Scenario: 局部修正再次错误
- **WHEN** 学生对局部修正任务仍给出错误答案
- **THEN** 系统 SHALL 保留同一个原任务与纠错 id
- **AND** SHALL 更新第一处错误并增加尝试次数

#### Scenario: 纠错中途重启
- **WHEN** 应用在等待局部修正或恢复原题作答时重启
- **THEN** 系统 SHALL 从课堂会话恢复相同阶段、原任务和当前待答任务

### Requirement: 局部修正必须独立核对但不得形成掌握证据
系统 MUST 对带纠错上下文的真实局部修正作答调用独立判卷，同时 MUST NOT 使用该回合更新掌握度或推进教案。

#### Scenario: 局部修正正确
- **WHEN** 独立判卷确认学生已修正当前第一处错误
- **THEN** 系统 SHALL 记录该修正用于纠错阶段转换
- **AND** `student_state_update` SHALL 为 null

#### Scenario: 局部修正判卷不可用
- **WHEN** 判卷失败、信息不足或任务无效
- **THEN** 系统 SHALL 保持当前纠错任务和原任务不变
- **AND** SHALL NOT 猜测修正已经完成

### Requirement: 修正正确后恢复原任务
系统 MUST 在局部修正正确后恢复原任务，让学生从已保留的正确部分继续完成完整作答。

#### Scenario: 多步方程局部修正正确
- **WHEN** 学生把第一处错误等式改为成立步骤
- **THEN** 教师 SHALL 明确该步骤已修正并保留此前成立部分
- **AND** 当前待答任务 SHALL 恢复原题且标记为 `scaffolded`

#### Scenario: 原任务没有有效快照
- **WHEN** 纠错上下文损坏或缺少原任务提示
- **THEN** 系统 SHALL 保持诊断模式并要求一个可判定的小步骤
- **AND** SHALL NOT 伪造原题或评分契约

### Requirement: 提示后完成必须经过无提示复查
系统 MUST 把恢复原题后的正确作答标记为提示后完成，并自动安排一道新的无提示同构复查。

#### Scenario: 恢复原题后答对
- **WHEN** 学生正确完成 `retry_original` 阶段的原任务
- **THEN** 正向证据 SHALL 标记为 `prompted`
- **AND** 教师 SHALL 主动生成一道不带提示、只改变一个条件的同构题
- **AND** SHALL NOT 在此时解除干预或推进教案

#### Scenario: 无提示复查答对
- **WHEN** 学生独立正确完成新的同构复查
- **THEN** 系统 SHALL 解除当前干预
- **AND** SHALL 允许该独立证据按现有掌握门槛推进教案

#### Scenario: 无提示复查仍错误
- **WHEN** 学生在同构复查中再次出现错误
- **THEN** 系统 SHALL 基于新题的新证据重新定位第一处错误
- **AND** SHALL 保持教案步骤不变

### Requirement: 纠错闭环拥有客户端状态权威
系统 MUST 在主教师回复与当前纠错阶段冲突时，以客户端阶段转换为准。

#### Scenario: 单步修正正确但教师布置新题
- **WHEN** 当前阶段为 `repair_step` 且独立判卷确认修正正确
- **THEN** 客户端 SHALL 忽略主教师的新题并恢复原任务

#### Scenario: 恢复原题正确但教师宣称掌握
- **WHEN** 当前阶段为 `retry_original` 且本轮正确依赖此前提示
- **THEN** 客户端 SHALL 移除已掌握结论和额外任务
- **AND** SHALL 安排无提示复查

