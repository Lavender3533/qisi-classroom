## ADDED Requirements

### Requirement: 规范知识成分目录
系统 MUST 使用科目内稳定的规范知识成分 ID 组织教学、证据与复习，并 SHALL 将课程标题、题目措辞和模型生成别名与身份分离。

#### Scenario: 同义旧知识点归并
- **WHEN** 多个旧知识点名称高置信地描述同一稳定能力
- **THEN** 系统 SHALL 将它们映射到同一规范知识成分
- **AND** SHALL 保留每个旧名称、原始记录和来源用于追溯

#### Scenario: 语义归并存在歧义
- **WHEN** 客户端与隔离复核不能高置信确认两个知识点同义
- **THEN** 系统 MUST 保持它们分离或标记为待审候选
- **AND** MUST NOT 自动混合二者的学习证据

#### Scenario: 教师提出新的知识点措辞
- **WHEN** 教师回合返回一个新的知识点名称
- **THEN** 系统 SHALL 先匹配规范 ID 或已知别名
- **AND** 模型不得仅通过新名称创建一个可立即接收掌握证据的正式知识成分

### Requirement: 追加式分级学习证据
系统 MUST 使用追加式可信记录区分 introduced、recognized、guided、independent、transferred 和 retained，并 MUST 从记录派生当前阶段。

#### Scenario: 完整讲解产生 introduced
- **WHEN** 教师完成与当前规范知识成分一致且通过结构验证的讲解合同
- **THEN** 系统 SHALL 记录 introduced 证据
- **AND** 仅有 `teacher_move=explain` 或长段文字 MUST NOT 单独产生 introduced

#### Scenario: 提示后正确
- **WHEN** 学生在提示、示范或答案暴露后完成任务
- **THEN** 系统 SHALL 最多记录 guided
- **AND** MUST NOT 将该证据提升为 independent 或 transferred

#### Scenario: 独立迁移正确
- **WHEN** 学生在无提示且改变明确条件的新任务中提供可信正确证据
- **THEN** 系统 SHALL 记录 transferred
- **AND** SHALL 允许当前知识成分结束并进入后续内容

#### Scenario: 延迟检索成功
- **WHEN** 学生在达到最小延迟间隔后无提示完成绑定同一规范知识成分的检索任务
- **THEN** 系统 SHALL 记录 retained
- **AND** retained 检查 MUST NOT 作为当天进入下一知识成分的阻塞条件

#### Scenario: 后续答案错误
- **WHEN** 学生在已有高级历史证据后出现一次错误
- **THEN** 系统 SHALL 记录失败和当前缺口并调整复习优先级
- **AND** MUST NOT 删除或改写已有可信历史证据

### Requirement: 兼容掌握度投影
系统 SHALL 在迁移期保留现有 mastery 接口，但 MUST 将百分比视为由规范证据阶段派生的兼容投影，而非课程推进的唯一真相。

#### Scenario: 旧模块读取掌握度
- **WHEN** 尚未迁移的界面或调度代码请求 mastery
- **THEN** 系统 SHALL 返回有界兼容投影
- **AND** 相同证据记录 MUST 产生稳定一致的投影

#### Scenario: 旧写入尝试越级
- **WHEN** 旧路径提交正向 mastery delta 但缺少独立任务绑定和可信证据
- **THEN** 系统 MUST NOT 因该 delta 产生 independent、transferred 或 retained
- **AND** SHALL 保留兼容事件用于审计

### Requirement: 确定性教学决策
系统 MUST 由客户端根据证据缺口、支持级别、连续困难、学生意图和前置状态决定唯一下一教学动作，模型不得自行扩大或重复任务。

#### Scenario: 迁移检查通过
- **WHEN** 当前规范知识成分获得新的可信 transferred 证据
- **THEN** 系统 SHALL 立即关闭当前即时检查
- **AND** MUST NOT 追加解释性复述、同构题或要求学生再次证明同一能力

#### Scenario: 提示后完成
- **WHEN** 当前成功证据的支持级别为 prompted
- **THEN** 系统 SHALL 最多安排一次新的无提示检查
- **AND** 同一 guided 证据不得触发连续复查链

#### Scenario: 第一次错误
- **WHEN** 学生对当前任务首次提供可信错误证据
- **THEN** 教师 SHALL 直接指出第一处关键差异、完整讲解并给出正确答案
- **AND** 系统 MUST NOT 要求学生重做原题直到答对

#### Scenario: 连续同类困难
- **WHEN** 同一规范误解第二次出现
- **THEN** 系统 SHALL 缩小任务并更换表示方式
- **AND** 当该困难第三次出现时 SHALL 暂停当前难度并检查最小前置知识

#### Scenario: 学生提出概念问题
- **WHEN** 学生在任务期间询问概念、原理或区别
- **THEN** 系统 SHALL 暂停当前任务并先完成讲解
- **AND** 本轮 MUST NOT 催答、评分或使用旧任务更新证据

#### Scenario: 学生明确要求前进
- **WHEN** 学生明确要求跳过当前复查或进入下一内容
- **THEN** 系统 SHALL 允许前进并保存未验证缺口到复习计划
- **AND** MUST NOT 通过追加相近题强行阻塞学生

### Requirement: 可验证讲解合同
系统 SHALL 要求讲解和示范使用结构化合同，包含旧知连接、心智模型、带子目标示例、关键对比或边界以及小结。

#### Scenario: 讲解合同完整
- **WHEN** 教师回合的各部分与当前规范知识成分一致且通过内容验证
- **THEN** 系统 SHALL 展示完整讲解并记录 introduced
- **AND** 本阶段 SHALL NOT 显示评分任务编辑器

#### Scenario: 讲解合同缺失关键部分
- **WHEN** 模型只返回结论、泛泛类比或缺少示例与边界
- **THEN** 系统 SHALL 请求一次结构修复或使用保守本地合同补齐教学安排
- **AND** MUST NOT 把不完整内容记录为已讲授证据

### Requirement: 证据导向学习档案
系统 SHALL 优先向学生展示规范知识成分的当前证据阶段、下一缺口和复习状态，而不是仅展示模糊百分比。

#### Scenario: 当前可以推进但尚未延迟保持
- **WHEN** 当前知识成分已达到 transferred 但尚无 retained
- **THEN** 界面 SHALL 明确显示“当前可推进”与“待延迟复习”
- **AND** SHALL 提供进入下一内容的主操作

#### Scenario: 旧课程只有 mastery
- **WHEN** 课程尚未形成新分级证据
- **THEN** 界面 SHALL 将旧百分比标记为历史估计
- **AND** MUST NOT 把它显示成已验证的高级掌握阶段

### Requirement: 教学质量回放评测
系统 MUST 使用真实会话回放和确定性指标验证教学节奏、停止行为、知识碎片与证据归因。

#### Scenario: 连续任务退化
- **WHEN** 回放中教师连续生成未获教案授权的相近任务
- **THEN** 评测 SHALL 报告连续任务链和重复语义任务
- **AND** 该回放 MUST NOT 通过教学质量门槛

#### Scenario: 达标后仍继续检查
- **WHEN** 回放已经产生 transferred 证据但教师继续要求同一能力的即时证明
- **THEN** 评测 SHALL 报告停止延迟和多余回合数
- **AND** 该回放 MUST NOT 通过教学质量门槛

#### Scenario: 旧会话与重启恢复
- **WHEN** 系统迁移并恢复一个只有旧 mastery 和旧聊天记录的课程
- **THEN** 回放 SHALL 验证原始数据仍存在、规范映射稳定且没有伪造高级证据
- **AND** 重启后下一教学动作 SHALL 与重启前一致

