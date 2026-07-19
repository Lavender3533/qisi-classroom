## ADDED Requirements

### Requirement: 教师主动接管关键课堂节点
系统 MUST 在小测完成、干预需要无提示再检查或课时进入总结阶段时主动安排教师回合，而不是等待学生再次发言或点击小结。

#### Scenario: 小测正确并进入下一步骤
- **WHEN** 学生以独立证据完成随堂测验且课时步骤推进
- **THEN** 教师 SHALL 引用本次正确证据并主动开始新的教案步骤

#### Scenario: 提示后修正小测
- **WHEN** 学生第二次作答正确且使用过提示
- **THEN** 教师 SHALL 主动给出一道不带提示的同构检查
- **AND** SHALL NOT 宣称该知识点已经独立掌握

#### Scenario: 课时进入总结阶段
- **WHEN** 可信学生证据使当前步骤推进到 summary
- **THEN** 教师 SHALL 自动生成有证据的课堂小结
- **AND** SHALL NOT 要求学生先点击小结按钮或再次发送消息

### Requirement: 续讲不伪造学生发言
系统 MUST 将自动续讲请求作为临时编排上下文，并对同一课堂节点去重。

#### Scenario: 自动续讲执行
- **WHEN** 客户端安排教师续讲
- **THEN** 编排命令 SHALL NOT 显示、持久化或计为学生消息
- **AND** 同一续讲键 SHALL 最多自动执行一次

