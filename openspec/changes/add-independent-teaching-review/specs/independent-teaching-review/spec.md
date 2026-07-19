## ADDED Requirements

### Requirement: 高风险教学内容展示前必须独立复核
系统 MUST 在展示引入或纠正学科知识的讲解、示范、反馈，以及包含新评分任务的教师回合前执行隔离上下文的独立教学复核。

#### Scenario: 教师生成概念讲解
- **WHEN** 候选回合的动作是 `explain` 或 `model`
- **THEN** 系统 SHALL 在展示前复核中心结论、示例过程和可见检查题

#### Scenario: 教师生成新可判定任务
- **WHEN** 候选回合包含 `knowledge_check` 或 `practice` 及隐藏评分契约
- **THEN** 系统 SHALL 独立求解任务并核对题目、参考答案和评分要点

#### Scenario: 课堂确认或无知识内容
- **WHEN** 回合只处理 readiness、学习方式选择或原任务提醒且没有新学科主张
- **THEN** 系统 MAY 跳过额外复核

### Requirement: 复核结果必须有可验证问题证据
系统 MUST 只接受高置信度通过结论，或包含逐字问题证据和完整替代回合的修订结论。

#### Scenario: 复核通过
- **WHEN** 复核返回 `pass`、置信度至少 0.72 且问题列表为空
- **THEN** 系统 SHALL 保留候选教学回合

#### Scenario: 复核要求修订
- **WHEN** 复核返回 `revise`、置信度至少 0.75，且每个问题片段逐字存在于对应目标
- **THEN** 系统 SHALL 校验完整替代回合
- **AND** 只有替代回合通过结构与任务契约时 SHALL 使用它

#### Scenario: 复核字段无效
- **WHEN** 问题片段不存在、目标无效、置信度不足或替代回合不完整
- **THEN** 系统 SHALL 将复核标记为不可用
- **AND** SHALL NOT 声称候选内容已经通过复核

### Requirement: 复核必须覆盖学科正确性与题目一致性
独立复核 MUST 检查事实与逻辑正确性、示例过程、题目可解性、隐藏答案键和评分标准之间的一致性。

#### Scenario: 方程讲解错误
- **WHEN** 候选讲解把 `x+3=5` 错误推导为 `x=8`
- **THEN** 复核 SHALL 返回 `revise`
- **AND** 替代回合 SHALL 使用等式两边相同运算得到成立结果

#### Scenario: Python range 解释错误
- **WHEN** 候选讲解声称 `range(1,5)` 包含 5
- **THEN** 复核 SHALL 返回 `revise`
- **AND** SHALL 修正结束值不包含在序列中的规则

#### Scenario: 隐藏答案键与题目冲突
- **WHEN** 题目学科结果与 `reference_answer` 或 criteria 冲突
- **THEN** 复核 SHALL 修正隐藏评分契约或将任务替换为有效任务

### Requirement: 教学复核不得篡改学生证据
系统 MUST 在使用替代回合时保留候选回合中的学生学情、错因、课堂总结和作业更新字段，并继续应用现有客户端权威策略。

#### Scenario: 错误反馈被修订
- **WHEN** 独立判卷已经确认学生答案错误且教学复核修正了教师解释
- **THEN** 替代回合 SHALL NOT 把负向证据改为正向
- **AND** 客户端独立判卷 SHALL 继续拥有最终学情权威

#### Scenario: 复核器尝试修改 mastery
- **WHEN** 替代回合包含自己的 `student_state_update` 或 `learning_diagnosis`
- **THEN** 系统 SHALL 忽略这些替代字段并保留原候选字段

### Requirement: 复核等待状态准确可见
系统 SHALL 在主教师生成与独立教学复核期间显示准确状态，并阻止未经复核的候选流内容提前进入课堂。

#### Scenario: 主教师流式返回纯文本
- **WHEN** 候选内容尚未完成复核
- **THEN** 系统 SHALL 只累计候选文本
- **AND** SHALL NOT 将其直接写入教师气泡

#### Scenario: 教学复核较慢
- **WHEN** 复核调用超过即时响应时间
- **THEN** 界面 SHALL 显示“正在复核讲解与题目”及慢响应状态

