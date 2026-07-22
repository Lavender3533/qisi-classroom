## ADDED Requirements
### Requirement: 教案阶段控制讲授与检查节奏
系统 MUST 由当前教案阶段决定是否要求学生作答。讲解和示范阶段 SHALL 允许教师连续完成一个知识块，不得为满足结构化协议而每轮生成题目。

#### Scenario: 教案处于讲解阶段
- **WHEN** 当前步骤为 `explain` 或 `model`
- **THEN** 教师 SHALL 完成概念模型、示例、关键对比和小结
- **AND** 客户端 SHALL 接受 `student_task.kind = none`
- **AND** 界面 SHALL NOT 显示待答编辑器或催答状态

#### Scenario: 教案到达练习或检查阶段
- **WHEN** 当前步骤为 `practice` 或 `check`
- **THEN** 教师 SHALL 只生成一个具体、可判定的任务
- **AND** 任务 SHALL 与当前步骤的证据目标一致

### Requirement: 正确答案后按教案推进
系统 MUST 在日常课堂正确作答后先完成具体反馈，并依据教案进入下一教学步骤，不得默认立即生成另一道同构题。

#### Scenario: 学生在练习阶段答对
- **WHEN** 独立判卷确认当前练习正确
- **THEN** 教师 SHALL 说明正确原因并提炼本题规则
- **AND** 客户端 SHALL 依据教案推进到下一步骤
- **AND** 除非下一步骤明确为检查，教师 SHALL NOT 立即生成新题

#### Scenario: 学生在检查阶段答对
- **WHEN** 独立判卷确认当前检查题正确
- **THEN** 系统 SHALL 记录当前门槛证据并进入总结或下一讲授步骤
- **AND** SHALL NOT 继续生成同构题链

