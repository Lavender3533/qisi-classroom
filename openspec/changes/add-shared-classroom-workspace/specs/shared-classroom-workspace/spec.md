## ADDED Requirements

### Requirement: 持续共享板书
系统 SHALL 在课堂中央提供持续板书，并 MUST 只应用已经完成独立复核的最终教师 `board_update`。

#### Scenario: 教师讲解后更新板书
- **WHEN** 最终教师回合包含合法且通过复核的 `replace` 或 `append` 板书更新
- **THEN** 系统按顺序显示不超过 6 条板书内容，并将结果保存到当前教学会话

#### Scenario: 候选板书尚未复核
- **WHEN** 模型仍在流式生成、教学复核尚未完成或复核要求修订
- **THEN** 系统不得显示候选板书，只能应用最终通过或修订后的板书更新

#### Scenario: 新课时开始
- **WHEN** 当前课时 key 与已保存板书所属课时不同
- **THEN** 系统不得把上一课时板书带入新课时

### Requirement: 唯一当前任务工作区
系统 MUST 使用教学会话中的 `pendingStudentTask` 显示唯一当前任务、知识点和期望回答格式，并 MUST 隐藏所有内部评分字段。

#### Scenario: 教师留下待答任务
- **WHEN** 最终教师回合产生非 `none` 的 `pendingStudentTask` 且没有专用测验或练习面板接管
- **THEN** 系统在任务工作区显示任务和直接作答编辑器，并把通用输入框标记为自由提问或补充

#### Scenario: 专用编辑器接管
- **WHEN** 当前 `pendingAction` 为 `show_quiz` 或 `open_practice_panel`
- **THEN** 系统隐藏通用任务作答编辑器，由对应专用编辑器接收学生答案

#### Scenario: 当前没有待答任务
- **WHEN** `pendingStudentTask.kind` 为 `none` 或任务缺少可显示提示
- **THEN** 系统隐藏任务作答工作区，但保留自由提问入口

### Requirement: 任务绑定提交
系统 MUST 将直接作答与当前 task key 绑定，并 SHALL 让有效提交继续进入原有聊天保存、独立判卷、错因诊断和证据更新链路。

#### Scenario: 学生提交当前任务
- **WHEN** 学生在任务工作区填写非空答案且 task key 仍与教学会话一致
- **THEN** 系统显示明确的提交中状态、保存学生回答并按该任务执行教师反馈与独立验证

#### Scenario: 学生提交过期任务
- **WHEN** 作答编辑器绑定的 task key 已被新的教师任务替换
- **THEN** 系统拒绝发送旧答案、提示任务已更新，并重新显示最新任务

### Requirement: 课堂调节动作
系统 SHALL 在知识或诊断任务中提供请求提示和换种讲法动作，并 MUST 将其作为学生课堂调节请求而不是学科答案处理。

#### Scenario: 学生请求提示
- **WHEN** 学生在当前任务中激活请求提示
- **THEN** 系统发送与当前任务绑定的困难信号，教师只提供分级提示且不得据此更新掌握度

#### Scenario: 学生请求换种讲法
- **WHEN** 学生激活换种讲法
- **THEN** 系统发送课堂节奏与表示方式请求，教师更换一种表示方式并保留唯一当前任务

### Requirement: 课堂恢复与可访问性
系统 MUST 在刷新、切换标签和继续学习时恢复板书与当前任务，并 SHALL 在最小桌面窗口中保持键盘可达、状态可读和无横向溢出。

#### Scenario: 恢复未完成课堂
- **WHEN** 学生重新打开包含 `teachingBoard` 和 `pendingStudentTask` 的教学会话
- **THEN** 系统恢复相同板书与任务，不自动提交、不朗读历史内容且不显示隐藏答案

#### Scenario: 900×600 窗口
- **WHEN** 应用窗口为 900×600
- **THEN** 板书和任务工作区采用紧凑单列布局，消息区仍可滚动且页面没有横向滚动
