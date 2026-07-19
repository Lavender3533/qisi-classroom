# Change: 完成学生端连续学习工作台

## Why
当前应用已经具有桌面 workbench 外壳，但模型配置、顶部菜单、设置、连续教学、练习编辑器及笔记/作业/复习仍有占位或断链。应用不能把模型名称显示、静态输入框或空状态视为完成的功能。

## What Changes
- 建立应用自己的可持久化模型配置，并支持从本机 Hermes 当前 provider 安全导入。
- 将模型健康状态区分为未配置、连接中、在线、鉴权失败、服务不可达，不再用单一离线状态掩盖原因。
- 采用集中命令注册表统一驱动顶部菜单、Command Center 与快捷键。
- 让所有设置项可保存、可恢复、立即生效。
- 持久化课程会话和教学状态，实现跨标签、跨窗口、跨重启连续学习。
- 增加自适应教师编排，根据摸底、薄弱点、最近错误和当前课程明确本节目标与下一步教学动作。
- 使用 CodeMirror 6 构建按需加载的随堂练习编辑器，并接入课程上下文补全、提示、诊断、运行、判题、错因分析和学习事件。
- 接通真实笔记、作业、错题与复习数据，不显示伪造数据。

## Impact
- Affected specs: runtime-model-config, desktop-commands, continuous-teaching, practice-editor, learning-records
- Affected code: frontend/app.js、frontend/teacher-engine.js、前端模块、src-tauri/src/main.rs、SQLite schema、package dependencies
- Migration: 现有 SQLite 数据保留，新增配置与课程会话表
