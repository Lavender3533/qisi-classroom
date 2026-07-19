## Context
教学引擎已经维护 `lessonPlan`、`lessonProgress`、`pendingStudentTask`、`visual` 和证据账本，但课堂中央仍是线性消息流。真实教师会持续维护共同注意对象：学生始终知道黑板上保留什么、当前只需要做什么、答案应写在哪里。

## Goals / Non-Goals
- Goals: 建立持续共享板书；把待答任务变成直接可操作的工作区；保证提交与任务绑定；在恢复课堂时保持状态；让板书内容经过独立学科复核。
- Non-Goals: 自由绘图画布、多人协作、手写识别、公式排版引擎、屏幕录制、替换现有代码编辑器或测验编辑器。

## Decisions
- Decision: 新增纯前端 `classroom-workspace.js`，负责板书更新归一化、会话合并、任务工作区派生与过期任务判断，便于无 DOM 单元测试。
- Decision: 教师结构新增 `board_update`，格式为 `mode/title/items`。`replace` 替换当前板书，`append` 在同一主题追加，`clear` 清空，`keep` 保留；客户端最多保留 6 条、每条 180 字。
- Decision: 板书只在最终教师回合完成独立复核后应用。复核器把 `board` 加入允许的问题目标，并在修订回合中提供完整替代板书更新。
- Decision: 当前任务继续以现有 `pendingStudentTask` 为权威来源；界面不得读取或显示隐藏 `assessment`。
- Decision: 任务提交携带当前 task key。key 与会话不一致时客户端拒绝发送并重新渲染最新任务，避免学生答案被错配到已经变化的问题。
- Decision: `show_quiz` 和 `open_practice_panel` 仍由专用编辑器接管；存在对应 `pendingAction` 时隐藏通用任务作答区，防止双重提交。
- Decision: 板书作为编辑器内全宽信息带，任务作为 composer 上方的全宽工作带；不使用浮空卡片、营销式大标题或装饰动画。

## Risks / Trade-offs
- 板书可能泄露当前任务答案 -> 独立复核检查 `board` 与答案键的一致性和泄露风险；客户端只应用复核后的最终回合。
- 模型可能省略或输出无效板书 -> 无效更新按 `keep` 处理，不破坏已有板书；课堂仍可正常进行。
- 工作区占用垂直空间 -> 板书限制为 6 条并采用紧凑网格；900×600 下任务区使用单列并保持消息区可滚动。
- 旧教学会话没有板书字段 -> 初始保持隐藏，收到首个合法更新后出现，不伪造历史板书。

## Migration Plan
无需数据库结构迁移。`teachingBoard` 是教学会话 JSON 的可选字段；旧会话按空板书处理。回滚时旧版本会忽略新增 JSON 字段。
