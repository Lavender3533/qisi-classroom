## Context
启思学堂是本地优先的学生端 Tauri 应用。当前模型配置依赖未注入的环境变量，设置界面无保存行为；菜单和多个模块只有视觉外壳；教学状态没有完整持久化。

## Decisions

### 1. 配置优先级
1. 应用 SQLite 中显式保存的配置。
2. 首次启动时可从 Hermes 当前 custom provider 导入。
3. 兼容环境变量作为开发/部署种子。
4. 没有有效地址或密钥时明确显示“未配置”，禁止使用 `dummy` 冒充配置。

### 2. 命令系统
参考 Hermes 的集中命令注册表：菜单、Command Center、快捷键只声明一次，所有入口调用相同 command handler，避免出现可见但无行为的按钮。

### 3. 编辑器
采用 CodeMirror 6 并按需加载，避免编辑器依赖增加桌面应用首屏体积。Python 智能功能分层：
- CodeMirror completion 与 lint 扩展：课程知识点、变量、函数、标准语法片段和实时语法诊断。
- Rust/Python 校验：语法、AST 规则、测试代码、运行错误。
- 教学编排器：根据错误和提示使用情况生成下一步反馈。

### 4. 连续教学
SQLite 保存 active course、lesson state、current step、chat/quiz/practice events。所有状态迁移先持久化再更新 UI，重启后从最近未完成会话恢复。

### 5. 开源借鉴边界
借鉴 VS Code/Monaco、Obsidian 与 Hermes 的公开交互和架构模式；不复制未核实许可证的产品代码或资源。

## Risks / Trade-offs
- Hermes 导入是可选能力，应用仍可独立配置。
- API key 暂存于应用本地数据库；正式发布前应迁移到 Windows Credential Manager 或 Tauri Stronghold。
- CodeMirror 独立分包仍会增加安装体积，但不阻塞课堂工作台首屏加载。

## Rollout
严格垂直切片：模型配置 → 命令系统 → 设置 → 连续教学 → 编辑器 → 真实数据模块 → 端到端验收。每片均采用 RED-GREEN-REFACTOR。
