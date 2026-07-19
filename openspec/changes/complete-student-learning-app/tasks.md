## 1. Runtime Model Configuration
- [x] 1.1 为配置读取、Hermes 导入与持久化添加失败测试
- [x] 1.2 新增 SQLite app_config 与迁移
- [x] 1.3 实现 get/save/import 配置命令
- [x] 1.4 实现可解释的健康检查状态
- [x] 1.5 接通设置 UI 并验证真实网关在线

## 2. Desktop Command System
- [x] 2.1 建立集中命令注册表
- [x] 2.2 实现文件/视图/学习/帮助菜单
- [x] 2.3 让菜单、Command Center、快捷键调用同一命令

## 3. Functional Settings
- [x] 3.1 模型、主题、字体、布局设置可保存与恢复
- [x] 3.2 设置变更立即生效并提供成功/失败反馈

## 4. Continuous Teaching
- [x] 4.1 设计课程会话和状态迁移表
- [x] 4.2 持久化摸底、讲解、练习、小测、总结状态
- [x] 4.3 重启恢复最近未完成课堂
- [x] 4.4 接通讲解配图与章节评估
- [x] 4.5 根据摸底、薄弱点和近期作答生成教师教学简报
- [x] 4.6 接入教师讲台、本节目标、教学阶段和下一步动作
- [x] 4.7 校验并持久化有证据、有限幅的教师学情判断

## 5. Practice Editor
- [x] 5.1 集成按需加载的 CodeMirror 6 编辑器
- [x] 5.2 实现 Python 补全、悬停提示、诊断和快捷键
- [x] 5.3 接通运行、AST/测试判题、提示链和老师反馈
- [x] 5.4 保存练习事件、错因和知识画像更新

## 6. Real Learning Modules
- [x] 6.1 接通真实笔记
- [x] 6.2 接通真实作业
- [x] 6.3 接通错题与复习调度

## 7. Verification
- [x] 7.1 单元、契约、Rust 和生产构建通过
- [x] 7.2 真实 Tauri 端到端验证
- [x] 7.3 空状态、离线、错误、重启恢复验收

## 8. Legacy Cleanup
- [x] 8.1 删除无引用的 Python/FastAPI/pywebview 与旧 web 前端
- [x] 8.2 删除根目录重复前端并修复 Tauri/Vite 开发脚本
- [x] 8.3 更新 README、忽略规则和动态导入冗余
