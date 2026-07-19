## Context

课堂已有 `practicePanel` 底部面板和 `renderInlineQuiz` 内联小测。新设计需要沿用桌面工作台结构，同时不能破坏 AI action 中现有的 `show_quiz` 数据契约。

## Goals / Non-Goals

- Goals: 让随堂测验成为独立、可聚焦、可恢复的答题工作区。
- Goals: 保持现有选择题、填空题、错题记录与学习事件兼容。
- Non-Goals: 不提供教师侧题目创作器，不引入新的编辑器框架或数据库表。

## Decisions

- Decision: 新增单例 `quizPanel`，与 `practicePanel` 共享底部停靠区域的交互语言，但各自管理内容和提交逻辑。
- Decision: 面板采用四段布局：可拖动标题栏、题干与元数据、答题编辑区、反馈与操作栏。
- Decision: 同一时刻只打开一个底部任务面板；打开小测时关闭代码练习，反之亦然，避免面板重叠。
- Decision: 保持 `show_quiz` action 和 quiz 对象格式不变，迁移仅发生在渲染边界。
- Decision: 关闭未作答测验只隐藏面板并保留 `pendingAction`，提交完成后才清除待处理动作。

## Risks / Trade-offs

- 面板占用课堂垂直空间：使用可拖动高度和 900x600 下的最大高度约束缓解。
- 两个底部面板可能争用状态：通过统一的互斥打开逻辑和独立 DOM 标识处理。
- 关闭后恢复时重复绑定事件：单例面板只初始化一次，每次打开只替换数据和重置视图状态。

## Migration Plan

保留 `renderInlineQuiz` 的答题判定逻辑作为迁移参考，先用纯函数提取判定结果，再将 `show_quiz` 和会话恢复入口切换到 `quizPanel.open()`。无需数据迁移。

