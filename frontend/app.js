/* =====================================================================
   启思学堂 - 学生端 Tauri 桌面应用
   我（学生）-> 选科目 -> 跟 AI 老师一对一学习
   ===================================================================== */

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  parseAIResponse,
  promoteAssessmentTab,
  reconcileChatHistory,
  validateAssessmentPayload,
} from './teaching-protocol.js';
import {
  deriveEvidenceStage,
  deriveTaskEvidenceStage,
  EVIDENCE_STAGE_META,
  projectMasteryFromEvidence,
} from './evidence-driven-instruction.js';
import {
  buildConfigPayload,
  connectionPresentation,
} from './app-config.js';
import {
  applyTeachingBoardUpdate,
  createDraftObservationState,
  DRAFT_OBSERVER_PREFERENCE_KEY,
  deriveDraftCoachingFeedback,
  deriveClassroomTaskWorkspace,
  deriveLessonWorkspaceKey,
  isDraftObservationSnapshotCurrent,
  isCurrentTaskSubmission,
  normalizeTeachingBoardUpdate,
  restoreTaskDraft,
  serializeTaskDraft,
  shouldShowCourseResume,
  shouldObserveStudentDraft,
  taskDraftStorageKey,
} from './classroom-workspace.js';
import {
  applyAnswerVerificationToTeacherTurn,
  buildAnswerVerificationDirective,
  enforceRepairClosureTurn,
  enforceStepwiseCorrectionTask,
  enforceVerifiedTeacherMessage,
  normalizeAnswerVerification,
  planRepairContinuation,
  shouldVerifyStudentAnswer,
  unavailableAnswerVerification,
} from './answer-verifier.js';
import {
  applyTeacherReview,
  normalizeTeacherReview,
  shouldReviewTeacherTurn,
  unavailableTeacherReview,
} from './teacher-review.js';
import { createCommandRegistry } from './command-registry.js';
import { formatJavaAccumulatorTrace, traceSimpleJavaAccumulator } from './code-trace.js';
import { buildLabSubmission, createJavaLabForFocus, normalizeCodingLab, updateLabAfterRun } from './programming-lab.js';
import {
  buildLearnerProfile,
  buildReviewQueue,
  deriveTeachingPreferenceSignal,
  deriveTeachingStrategyOutcome,
  normalizeTeachingPreferences,
  updateTeachingPreferences,
} from './learning-scheduler.js';
import {
  evaluateQuizAnswer,
  formatStudentMessageForDisplay,
  getCodeExerciseSubmission,
  getQuizCorrectAnswer,
  isEditableCodeExercise,
  isInternalTeacherCommand,
  planQuizAttempt,
  splitQuestionContent,
} from './quiz-engine.js';
import {
  buildSubjectNamingMessages,
  getDisplaySubjectName,
  parseSubjectNamingResponse,
  sanitizeLegacySubjectMessage,
  validateSubjectName,
} from './subject-naming.js';
import {
  assessTeacherTurnQuality,
  buildLessonMasterySnapshot,
  buildAssessmentTurnPrompt,
  buildTeacherBrief,
  buildTeacherSystemPrompt,
  buildTeacherTurnDirective,
  classifyStudentTurn,
  createFallbackLessonPlan,
  createTeacherGreeting,
  rebuildAssessmentProgress,
  routeAssessmentInterview,
  enforceStudentEvidenceSupport,
  enforceTeacherVisibleMessage,
  enforceTeacherContinuationPolicy,
  enforceTeacherTurnPolicy,
  getAssessmentInterviewStage,
  isConcreteStudentTaskPrompt,
  normalizeHomeworkUpdate,
  normalizeLearningDiagnosis,
  normalizeLessonPlan,
  normalizeLessonSummary,
  normalizeQuickReplies,
  normalizeStudentStateUpdate,
  normalizeStudentTask,
  normalizeTeacherMove,
  planRetrievalWarmup,
  planTeacherContinuation,
  studentTaskAllowsDiagnosisEvidence,
  updateLearningIntervention,
  updateLessonProgress,
  updateRetrievalWarmup,
} from './teacher-engine.js';
import {
  TEACHER_VOICE_MODES,
  createBrowserTeacherVoice,
  isTeacherVoiceAutoplayBlocked,
  readTeacherVoiceSettings,
  shouldAutoSpeakTeacherMessage,
  writeTeacherVoiceSettings,
} from './teacher-voice.js';
import { renderInlineRich } from './math-render.js';

// ============ 全局配置 ============
let APP_CONFIG = {
  base_url: '',
  api_key: '',
  models: {
    chat: 'mimo-v2.5-pro',
    fast: 'mimo-v2.5',
    vision: 'mimo-v2-omni',
    tts: 'mimo-v2.5-tts',
  },
};

// ============ 状态管理 ============
const state = {
  currentView: 'chat',       // chat | notes | homework | review | settings
  currentSubject: null,       // 当前选中的科目
  subjects: [],               // 科目列表
  tabs: [],
  activeTab: null,
  rightPanelCollapsed: false,
  sidebarCollapsed: false,
  // 每个科目的对话历史
  chatHistory: {},            // { subjectId: [{ role, content }] }
  selectedNoteId: null,
  teachingSessions: {},
};

const LAYOUT_KEYS = {
  sidebarWidth: 'warmclassroom.layout.sidebarWidth',
  inspectorWidth: 'warmclassroom.layout.inspectorWidth',
  sidebarCollapsed: 'warmclassroom.layout.sidebarCollapsed',
  inspectorCollapsed: 'warmclassroom.layout.inspectorCollapsed',
};

let commandRegistry = null;
let toggleCommandPalette = () => {};
let submitCodeExerciseToTeacher = null;
let commitQuizEvidence = null;
const teacherVoice = createBrowserTeacherVoice(window);
const teacherVoiceMessageMeta = new WeakMap();
let teacherVoiceMessageSequence = 0;
let studentHasTeacherVoiceFloor = false;
let teacherVoiceAutoplayBlocked = false;
let teacherVoiceAutoplayNoticeShown = false;
let automaticTeacherVoiceMessageId = null;

const STUDENT_RESPONSE_SELECTOR = [
  '#assessInput',
  '#input',
  '#taskAnswer',
  '#taskSubmit',
  '#taskHint',
  '#taskAlternate',
  '#taskObserverToggle',
  '.quick-replies [data-reply]',
  '.assess-option',
  '.assess-fill-input',
  '.assess-fill-btn',
  '#assessToTest',
  '.quiz-editor-option',
  '.quiz-editor-input',
  '.quiz-submit',
  '.message-code-editor',
  '.practice-editor',
  '.practice-panel .btn-run',
  '.practice-panel .btn-feedback',
].join(', ');

// ============ SVG 图标 ============
const ICONS = {
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`,
  notes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>`,
  homework: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    <path d="M9 14l2 2 4-4"/>
  </svg>`,
  review: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`,
  run: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  volume2: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  volumeX: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  xMark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  helpCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  messageSquare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  barChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
  cpu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
  palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  triangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>`,
  letter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  bug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 12h2"/><path d="M3 12h2"/><path d="M19 6h1a2 2 0 0 1 2 2"/><path d="M2 8a2 2 0 0 1 2-2h1"/><path d="M19 18h1a2 2 0 0 0 2-2"/><path d="M2 16a2 2 0 0 0 2 2h1"/><line x1="12" y1="6" x2="12" y2="20"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
};

const SUBJECT_ICON_KEYS = {
  python: 'code',
  code: 'code',
  math: 'triangle',
  eng: 'letter',
  english: 'letter',
  physics: 'zap',
};

function getSubjectIcon(subjectId) {
  return ICONS[SUBJECT_ICON_KEYS[subjectId] || 'book'];
}

function setIconText(element, icon, text) {
  element.innerHTML = `<span class="inline-icon" aria-hidden="true">${icon}</span>`;
  element.appendChild(document.createTextNode(text));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// 课堂身份图标采用统一的 Lucide 风格，不使用拟人笑脸。
const AVATAR = {
  teacher: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  me: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
};

function teacherVoiceButtonPresentation(button) {
  const settings = readTeacherVoiceSettings();
  const voiceState = teacherVoice.getSnapshot();
  const messageId = button.dataset.teacherVoiceId;
  const hasMessage = teacherVoiceMessageMeta.has(button);
  const active = voiceState.activeId === messageId;

  if (!voiceState.supported) {
    return { disabled: true, label: '不可用', title: '当前系统不支持教师语音', icon: ICONS.volumeX, pressed: false };
  }
  if (settings.mode === TEACHER_VOICE_MODES.OFF) {
    return { disabled: true, label: '已关闭', title: '教师语音已关闭，可在界面设置中开启', icon: ICONS.volumeX, pressed: false };
  }
  if (!hasMessage) {
    return { disabled: true, label: '准备中', title: '老师正在组织完整回复', icon: ICONS.volume2, pressed: false };
  }
  if (active && voiceState.status === 'speaking') {
    return { disabled: false, label: '朗读中', title: '暂停朗读', icon: ICONS.pause, pressed: true };
  }
  if (active && voiceState.status === 'paused') {
    return { disabled: false, label: '已暂停', title: '继续朗读', icon: ICONS.run, pressed: true };
  }
  if (active && voiceState.status === 'error') {
    return { disabled: false, label: '重试', title: '重新朗读这条教师消息', icon: ICONS.volume2, pressed: false };
  }
  return { disabled: false, label: '朗读', title: '朗读这条教师消息', icon: ICONS.volume2, pressed: false };
}

function syncTeacherVoiceButton(button) {
  if (!button) return;
  const presentation = teacherVoiceButtonPresentation(button);
  button.disabled = presentation.disabled;
  button.classList.toggle('is-active', presentation.pressed);
  button.setAttribute('aria-pressed', String(presentation.pressed));
  button.setAttribute('aria-label', presentation.title);
  button.title = presentation.title;
  const icon = button.querySelector('.teacher-voice-icon');
  const label = button.querySelector('.teacher-voice-label');
  if (icon) icon.innerHTML = presentation.icon;
  if (label) label.textContent = presentation.label;
}

function syncTeacherVoiceButtons() {
  document.querySelectorAll('.teacher-voice-button').forEach(syncTeacherVoiceButton);
}

function isStudentResponseTarget(target) {
  return Boolean(target?.closest?.(STUDENT_RESPONSE_SELECTOR));
}

function markStudentVoiceTurn() {
  studentHasTeacherVoiceFloor = true;
  automaticTeacherVoiceMessageId = null;
  const voiceState = teacherVoice.getSnapshot();
  if (voiceState.activeId || ['speaking', 'paused', 'error'].includes(voiceState.status)) {
    teacherVoice.stop();
  }
}

function releaseStudentVoiceTurn() {
  studentHasTeacherVoiceFloor = false;
  automaticTeacherVoiceMessageId = null;
  const voiceState = teacherVoice.getSnapshot();
  if (voiceState.activeId || ['speaking', 'paused', 'error'].includes(voiceState.status)) {
    teacherVoice.stop();
  }
}

function teacherVoiceModeDescription(settings) {
  if (settings.mode === TEACHER_VOICE_MODES.AUTO) {
    return teacherVoiceAutoplayBlocked
      ? '系统未允许自动播放，本次已改为点击消息朗读。'
      : '新回复自动朗读；学生开始回答时会立即停止，历史消息保持静音。';
  }
  return settings.mode === TEACHER_VOICE_MODES.MANUAL
    ? '仅在主动点击时朗读。'
    : '教师语音当前已关闭。';
}

function createTeacherVoiceButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'teacher-voice-button';
  button.dataset.teacherVoiceId = `teacher-message-${++teacherVoiceMessageSequence}`;
  button.disabled = true;
  button.innerHTML = `<span class="teacher-voice-icon" aria-hidden="true">${ICONS.volume2}</span><span class="teacher-voice-label">准备中</span>`;
  button.addEventListener('click', () => {
    const message = teacherVoiceMessageMeta.get(button);
    if (!message) return;
    const settings = readTeacherVoiceSettings();
    if (settings.mode === TEACHER_VOICE_MODES.OFF) return;
    automaticTeacherVoiceMessageId = null;
    teacherVoice.toggle({
      id: button.dataset.teacherVoiceId,
      text: message.text,
      rate: settings.rate,
    });
  });
  return button;
}

function bindTeacherVoiceControl(content, text, { autoSpeak = false } = {}) {
  const host = content?.closest('.msg.bot, .inline-exercise-review');
  const button = host?.querySelector('.teacher-voice-button');
  const speechText = String(text || '').trim();
  if (!button || !speechText) return;
  teacherVoiceMessageMeta.set(button, { text: speechText });
  syncTeacherVoiceButton(button);

  const isEligible = () => {
    const settings = readTeacherVoiceSettings();
    const view = document.getElementById('view');
    return shouldAutoSpeakTeacherMessage({
      autoSpeak,
      mode: settings.mode,
      visible: !document.hidden,
      connected: content.isConnected,
      currentContext: Boolean(view?.contains(content)),
      studentHasFloor: studentHasTeacherVoiceFloor,
      autoplayBlocked: teacherVoiceAutoplayBlocked,
    });
  };

  if (isEligible()) {
    queueMicrotask(() => {
      if (!isEligible()) return;
      const settings = readTeacherVoiceSettings();
      automaticTeacherVoiceMessageId = button.dataset.teacherVoiceId;
      const started = teacherVoice.speak({
        id: button.dataset.teacherVoiceId,
        text: speechText,
        rate: settings.rate,
      });
      if (!started) automaticTeacherVoiceMessageId = null;
    });
  }
}

teacherVoice.subscribe(voiceState => {
  syncTeacherVoiceButtons();
  if (voiceState.status === 'error'
    && voiceState.activeId === automaticTeacherVoiceMessageId
    && isTeacherVoiceAutoplayBlocked(voiceState.error)) {
    teacherVoiceAutoplayBlocked = true;
    automaticTeacherVoiceMessageId = null;
    teacherVoice.stop();
    if (!teacherVoiceAutoplayNoticeShown) {
      teacherVoiceAutoplayNoticeShown = true;
      showToast('系统未允许老师自动开口，本次已改为点击消息下方的“朗读”。', 'warn', 5200);
    }
  } else if (voiceState.status === 'idle') {
    automaticTeacherVoiceMessageId = null;
  }
});

function renderTeacherMoveFooter(bubble, move, studentTask = null) {
  if (!bubble || !move) return;
  bubble.querySelector('.teacher-move-footer')?.remove();
  const footer = document.createElement('div');
  footer.className = 'teacher-move-footer';
  const taskLabel = studentTask?.kind === 'learning_choice' ? '等你选择'
    : studentTask?.kind === 'readiness' ? '等你确认'
      : studentTask?.kind === 'none' ? '课堂状态' : '等你完成';
  const checkpoint = studentTask?.prompt || move.checkpoint;
  footer.innerHTML = `
    <div><span>${taskLabel}</span><strong>${escapeHtml(checkpoint)}</strong></div>
  `;
  bubble.appendChild(footer);
  const scroller = bubble.closest('.messages');
  if (scroller) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}

function updateLessonRhythm(phase) {
  const normalized = phase === 'diagnose' || phase === 'prepare' || phase === 'review' ? 'orient'
    : phase === 'explain' || phase === 'reteach' ? 'explain'
      : phase === 'practice' || phase === 'run_code' ? 'practice'
        : 'check';
  const order = ['orient', 'explain', 'practice', 'check'];
  const activeIndex = order.indexOf(normalized);
  document.querySelectorAll('.lesson-rhythm-step').forEach((step, index) => {
    step.classList.toggle('active', index === activeIndex);
    step.classList.toggle('completed', index < activeIndex);
    if (index === activeIndex) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}

function appendInlineCode(container, text) {
  renderInlineRich(container, text);
}

function renderRichMessage(container, value) {
  if (!container) return;
  const text = String(value ?? '');
  container.replaceChildren();
  const pattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    appendInlineCode(container, text.slice(cursor, match.index));
    const block = document.createElement('div');
    block.className = 'message-code-block';
    const header = document.createElement('div');
    header.className = 'message-code-header';
    const language = document.createElement('span');
    const languageId = match[1].trim() || 'text';
    const codeText = match[2].replace(/^\n|\n$/g, '');
    const editable = isEditableCodeExercise(codeText);
    const exercise = editable ? document.createElement('section') : null;
    if (exercise) {
      exercise.className = 'inline-code-exercise';
      exercise.dataset.state = 'editing';
      exercise.setAttribute('aria-label', '代码练习');
    }
    language.textContent = `${match[1].trim() || '代码'}${editable ? ' · 可编辑练习' : ''}`;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.title = '复制代码';
    copy.setAttribute('aria-label', '复制代码');
    copy.innerHTML = ICONS.copy;
    let editor = null;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(editor?.value ?? codeText);
        showToast('代码已复制', 'success');
      } catch {
        showToast('复制失败，请手动选择代码', 'warn');
      }
    });
    header.append(language, copy);
    block.appendChild(header);
    if (editable) {
      block.classList.add('is-editable');
      editor = document.createElement('textarea');
      editor.className = 'message-code-editor';
      editor.value = codeText;
      editor.rows = Math.min(14, Math.max(5, codeText.split('\n').length));
      editor.spellcheck = false;
      editor.setAttribute('aria-label', '直接编辑代码练习');
      const actions = document.createElement('div');
      actions.className = 'message-code-actions';
      const status = document.createElement('span');
      status.textContent = '在空白处填写代码';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'btn-secondary';
      reset.textContent = '重置代码';
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'btn-primary';
      submit.textContent = '提交练习';
      const submitCode = () => {
        const answer = editor.value.trim();
        if (!answer) {
          status.textContent = '代码不能为空';
          editor.focus();
          return;
        }
        const draft = `老师，请点评我刚完成的代码练习。\n我的代码：\n\`\`\`${languageId}\n${answer}\n\`\`\`\n请先检查我补全的位置，再指出一个最关键的改进点。`;
        if (submitCodeExerciseToTeacher?.(draft, exercise)) {
          setInlineCodeExerciseState(exercise, 'reviewing');
        } else {
          status.textContent = '课堂暂时无法提交，请稍后再试';
        }
      };
      reset.addEventListener('click', () => {
        editor.value = codeText;
        status.textContent = '已恢复初始代码';
        editor.focus();
      });
      submit.addEventListener('click', submitCode);
      editor.addEventListener('click', () => {
        if (editor.selectionStart !== editor.selectionEnd) return;
        const caret = editor.selectionStart;
        for (const blank of editor.value.matchAll(/_{3,}/g)) {
          const start = blank.index ?? 0;
          const end = start + blank[0].length;
          if (caret >= start && caret <= end) {
            editor.setSelectionRange(start, end);
            break;
          }
        }
      });
      editor.addEventListener('keydown', event => {
        if (event.key === 'Tab') {
          event.preventDefault();
          const start = editor.selectionStart;
          editor.setRangeText('    ', start, editor.selectionEnd, 'end');
        } else if (event.key === 'Enter' && event.ctrlKey) {
          event.preventDefault();
          submitCode();
        }
      });
      actions.append(status, reset, submit);
      block.append(editor, actions);
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeText;
      pre.appendChild(code);
      block.appendChild(pre);
    }
    if (exercise) {
      exercise.appendChild(block);
      container.appendChild(exercise);
    } else {
      container.appendChild(block);
    }
    cursor = pattern.lastIndex;
  }
  appendInlineCode(container, text.slice(cursor));
}

function setInlineCodeExerciseState(exercise, nextState, submittedCode = '') {
  if (!exercise) return;
  const editor = exercise.querySelector('.message-code-editor');
  const status = exercise.querySelector('.message-code-actions > span');
  if (editor && submittedCode) editor.value = submittedCode;
  const locked = nextState !== 'editing';
  if (editor) editor.disabled = locked;
  exercise.querySelectorAll('.message-code-actions button').forEach(button => { button.disabled = locked; });
  exercise.dataset.state = nextState;
  exercise.classList.toggle('is-submitted', locked);
  exercise.classList.toggle('is-reviewing', nextState === 'reviewing');
  exercise.classList.toggle('is-reviewed', nextState === 'reviewed');
  exercise.classList.toggle('has-review-error', nextState === 'error');
  if (status) {
    status.textContent = {
      editing: '在空白处填写代码',
      submitted: '已提交，等待老师批改',
      reviewing: '已提交，老师正在批改',
      reviewed: '已批改，作答已锁定',
      error: '批改暂未完成，可在下方重试',
    }[nextState] || '练习状态已更新';
  }
}

function getOrCreateInlineExerciseReview(exercise, teacherLabel) {
  if (!exercise) return null;
  let review = exercise.querySelector(':scope > .inline-exercise-review');
  if (!review) {
    review = document.createElement('section');
    review.className = 'inline-exercise-review';
    review.setAttribute('aria-label', '老师批改');
    const header = document.createElement('div');
    header.className = 'inline-exercise-review-header';
    const avatar = document.createElement('span');
    avatar.className = 'inline-exercise-review-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = AVATAR.teacher;
    const label = document.createElement('strong');
    label.textContent = teacherLabel;
    header.append(avatar, label, createTeacherVoiceButton());
    const content = document.createElement('div');
    content.className = 'inline-exercise-review-content';
    content.setAttribute('role', 'status');
    content.setAttribute('aria-live', 'polite');
    review.append(header, content);
    exercise.appendChild(review);
  }
  return review.querySelector('.inline-exercise-review-content');
}

// ============ 课堂状态机 ============
const LESSON_STATES = {
  PREPARE:     'prepare',       // 准备阶段：加载教案
  EXPLAIN:     'explain',       // 老师讲解知识点
  CHECK:       'check',         // 确认理解
  PRACTICE:    'practice',      // 弹出代码编辑器，学生动手
  RUN_CODE:    'run_code',      // 执行代码，获取结果
  FEEDBACK:    'feedback',      // 老师点评代码
  QUIZ:        'quiz',          // 小测
  NEXT_STEP:   'next_step',     // 答对->下一个知识点 / 答错->补讲
  SUMMARY:     'summary',       // 本节课总结
};

// ============ 练习面板管理 ============
const practicePanel = {
  _el: null,
  _editor: null,     // CodeMirror 实例
  _currentPractice: null,
  _hintIndex: 0,
  _subjectId: null,

  /** 创建练习面板 DOM（首次调用时初始化） */
  async _ensure() {
    if (this._el) return;
    const panel = document.createElement('div');
    panel.id = 'practicePanel';
    panel.className = 'practice-panel';
    panel.innerHTML = `
      <div class="practice-header">
        <span class="practice-title">${ICONS.code} 动手练习</span>
        <button class="practice-close" type="button" title="关闭" aria-label="关闭练习面板">${ICONS.close}</button>
      </div>
      <div class="practice-prompt"></div>
      <div class="practice-editor-wrap">
        <div class="practice-editor" aria-label="练习代码编辑器"></div>
      </div>
      <div class="practice-actions">
        <button class="btn-hint" type="button">${ICONS.lightbulb} 提示</button>
        <button class="btn-feedback" type="button">${ICONS.messageSquare} 请老师点评</button>
        <button class="btn-run btn-primary" type="button">${ICONS.run} 运行</button>
      </div>
      <div class="practice-hint" style="display:none"></div>
      <div class="practice-output">
        <div class="practice-output-label">输出</div>
        <pre class="practice-output-text"></pre>
      </div>
    `;
    // 插入到 workspace 内 #view 的父元素末尾
    const view = document.getElementById('view');
    if (view && view.parentElement) {
      view.parentElement.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
    this._el = panel;

    // 初始化 CodeMirror 编辑器
    try {
      const { createPracticeEditor } = await import('./codemirror-setup.js');
      const editorContainer = panel.querySelector('.practice-editor');
      this._editor = createPracticeEditor(editorContainer, {
        initialCode: '',
        placeholder: '在这里写 Python 代码…',
      });
    } catch (e) {
      console.warn('CodeMirror 初始化失败，回退到 textarea:', e);
      // 回退：替换为 textarea
      const wrap = panel.querySelector('.practice-editor-wrap');
      wrap.innerHTML = '<textarea class="practice-editor" spellcheck="false" placeholder="在这里写代码..." aria-label="练习代码编辑器"></textarea>';
    }

    // 事件绑定
    panel.querySelector('.practice-close').addEventListener('click', () => this.close());
    panel.querySelector('.btn-hint').addEventListener('click', () => this.showNextHint());
    panel.querySelector('.btn-feedback').addEventListener('click', () => this.askTeacher());
    panel.querySelector('.btn-run').addEventListener('click', () => this.runCode());
  },

  /** 获取编辑器内容 */
  _getCode() {
    if (this._editor) return this._editor.getValue();
    const ta = this._el?.querySelector('textarea.practice-editor');
    return ta ? ta.value : '';
  },

  /** 设置编辑器内容 */
  _setCode(code) {
    if (this._editor) {
      this._editor.setValue(code || '');
    } else {
      const ta = this._el?.querySelector('textarea.practice-editor');
      if (ta) ta.value = code || '';
    }
  },

  /** 打开练习面板并填充数据 */
  async open(practice) {
    await this._ensure();
    quizPanel.close({ preservePending: true });
    this._currentPractice = practice;
    this._subjectId = state.currentSubject;
    this._hintIndex = 0;
    const el = this._el;
    el.querySelector('.practice-prompt').textContent = practice.prompt || '';
    this._setCode(practice.starter_code || '');
    this._editor?.setCompletions(practice.completions || []);
    el.querySelector('.practice-hint').style.display = 'none';
    el.querySelector('.practice-hint').textContent = '';
    el.querySelector('.practice-output-text').textContent = '';
    el.classList.add('open');
    // 聚焦编辑器
    if (this._editor?.dom) {
      setTimeout(() => this._editor.view.focus(), 50);
    }
  },

  /** 关闭面板 */
  close({ preservePending = false } = {}) {
    if (this._el) this._el.classList.remove('open');
    if (this._subjectId && !preservePending) void persistTeachingSession(this._subjectId, { pendingAction: null });
    this._currentPractice = null;
    this._subjectId = null;
  },

  askTeacher() {
    const practice = this._currentPractice;
    const code = this._getCode().trim();
    if (!practice || !this._subjectId) return;
    if (!code) return showToast('先写下你的尝试，老师才能点评思路', 'warn');
    openTeacherWithDraft(this._subjectId, `老师，请点评我的代码练习。\n要求：${practice.prompt || ''}\n我的代码：\n${code}\n请先指出做对的部分，再定位一个最关键的问题，并给我下一步提示。`);
  },

  /** 显示下一条提示 */
  showNextHint() {
    const p = this._currentPractice;
    if (!p || !p.hints || !p.hints.length) return;
    const hintEl = this._el.querySelector('.practice-hint');
    if (this._hintIndex < p.hints.length) {
      hintEl.style.display = 'block';
      setIconText(hintEl, ICONS.lightbulb, `提示 ${this._hintIndex + 1}: ${p.hints[this._hintIndex]}`);
      this._hintIndex++;
    } else {
      setIconText(hintEl, ICONS.lightbulb, '已经没有更多提示了，加油！');
    }
  },

  /** 运行代码（通过 Tauri invoke 调用沙箱） */
  async runCode() {
    const code = this._getCode();
    const outputEl = this._el.querySelector('.practice-output-text');
    if (!code.trim()) {
      outputEl.textContent = '请先写下代码再运行。';
      outputEl.dataset.tone = 'error';
      return;
    }
    outputEl.textContent = '运行中...';
    const practice = this._currentPractice;
    const subjectId = this._subjectId;
    const testCode = practice?.test_code || '';
    try {
      const result = await invoke('run_python_code', { code, testCode });
      let output = result.stdout || result.stderr || '(无输出)';
      let passed = Boolean(result.success);

      // 如果有期望输出，验证结果
      if (practice?.expected_output && result.success) {
        try {
          const answerCorrect = await invoke('check_answer', {
            answer: result.stdout.trim(),
            correctAnswer: practice.expected_output,
            answerType: 'exact',
          });
          if (answerCorrect) {
            output = `[正确]\n${output}`;
          } else {
            passed = false;
            output = `[不正确] 期望输出: ${practice.expected_output}\n你的输出: ${output}`;
          }
        } catch (error) {
          passed = false;
          output += `\n[答案检查不可用] ${error}`;
        }
      }

      // 如果有 AST 验证规则
      if (practice?.validation_rule && result.success) {
        try {
          const astValid = await invoke('validate_code_ast', { code, rule: practice.validation_rule });
          if (!astValid) {
            passed = false;
            output += '\n[代码检查] 代码可以运行，但还没有使用本题要求的结构。';
          }
        } catch (error) {
          passed = false;
          output += `\n[代码结构检查不可用] ${error}`;
        }
      }

      outputEl.textContent = result.success ? output : `错误: ${output}`;
      outputEl.dataset.tone = passed ? 'success' : 'error';
      if (result.execution_time_ms) {
        outputEl.textContent += `\n(${result.execution_time_ms}ms)`;
      }

      // 记录学习事件
      try {
        await invoke('save_learning_event', {
          subjectId: subjectId || '',
          eventType: 'practice_submit',
          knowledgePointsJson: JSON.stringify([practice?.knowledge_point || '']),
          detailJson: JSON.stringify({ success: passed, hasTestCode: !!testCode, hintCount: this._hintIndex, errorType: result.error_type || null }),
        });
      } catch {}
      if (practice?.knowledge_point && subjectId) {
        try {
          const points = await invoke('get_knowledge_points', { subjectId });
          const existing = (points || []).find(point => point.name === practice.knowledge_point);
          const masteryUpdate = normalizeStudentStateUpdate({
            knowledge_point: practice.knowledge_point,
            mastery_delta: passed ? (this._hintIndex > 0 ? 0.04 : 0.08) : -0.03,
            confidence: 0.95,
            evidence: passed
              ? `代码练习通过，使用 ${this._hintIndex} 条提示`
              : `代码练习未通过，错误类型为 ${result.error_type || '检查未通过'}`,
          }, existing?.mastery || 0);
          if (masteryUpdate) {
            await invoke('add_knowledge_point', {
              subjectId,
              name: masteryUpdate.knowledgePoint,
              description: masteryUpdate.evidence,
              mastery: masteryUpdate.mastery,
            });
            await logLearningEvent(subjectId, 'practice_mastery_update', [masteryUpdate.knowledgePoint], masteryUpdate);
          }
        } catch (error) {
          console.warn('更新代码练习掌握度失败:', error);
        }
      }
      if (!passed && practice?.knowledge_point && subjectId) {
        invoke('save_mistake', {
          subjectId,
          knowledgePoint: practice.knowledge_point,
          question: practice.prompt || '代码练习',
          studentAnswer: code,
          correctAnswer: practice.expected_output || '通过题目测试与代码结构检查',
          errorType: result.error_type || 'practice_check_failed',
        }).catch(() => {});
      }
    } catch (e) {
      outputEl.textContent = '运行失败: ' + e.toString();
    }
  },
};

function renderQuestionContent(container, question) {
  const { prompt, code } = splitQuestionContent(question);
  const promptEl = document.createElement('div');
  promptEl.className = 'question-prompt';
  renderInlineRich(promptEl, prompt);
  container.replaceChildren(promptEl);
  if (code) {
    const pre = document.createElement('pre');
    pre.className = 'question-code';
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    container.appendChild(pre);
  }
}

function renderQuickReplyButtons(container, rawReplies) {
  if (!container) return;
  const replies = normalizeQuickReplies(rawReplies);
  container.replaceChildren();
  for (const reply of replies) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.reply = reply;
    button.textContent = reply;
    container.appendChild(button);
  }
  container.classList.toggle('is-hidden', replies.length === 0);
}

function extractChoiceRepliesFromText(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const matches = [...text.matchAll(/(?:^|\s)([A-D])[.、．]\s*(.{1,36}?)(?=\s+[A-D][.、．]|$)/gu)];
  const extracted = normalizeQuickReplies(matches.map(match => `${match[1]}. ${match[2].trim()}`));
  if (extracted.length) return extracted;
  const incrementStart = text.match(/初值(?:改为|是|为)\s*`?(\d+)`?/u);
  if (/a\+\+.*\+\+a/u.test(text) && incrementStart) {
    const initial = Number(incrementStart[1]);
    const result = initial + (initial + 2);
    return [
      `A. ${result - 1} · 两项是${initial}和${initial + 1}`,
      `B. ${result} · 两项是${initial}和${initial + 2}`,
      `C. ${result + 1} · 两项是${initial + 1}和${initial + 2}`,
    ];
  }
  return [];
}

function renderInlineQuickReplies(container, rawReplies, onSelect) {
  const replies = normalizeQuickReplies(rawReplies);
  if (!container || !replies.length) return null;
  const group = document.createElement('div');
  group.className = 'inline-quick-replies';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '选择一个答案');
  replies.forEach(reply => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = reply;
    button.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(item => { item.disabled = true; });
      onSelect(reply);
    });
    group.appendChild(button);
  });
  container.appendChild(group);
  return group;
}

const quizPanel = {
  _el: null,
  _quiz: null,
  _subjectId: null,
  _selectedAnswer: null,
  _submitted: false,
  _attempts: 0,

  _ensure() {
    if (this._el) return;
    const panel = document.createElement('section');
    panel.id = 'quizPanel';
    panel.className = 'quiz-panel';
    panel.setAttribute('aria-label', '随堂测验编辑器');
    panel.innerHTML = `
      <div class="quiz-resize-handle" role="separator" aria-label="调整测验编辑器高度" aria-orientation="horizontal" tabindex="0"></div>
      <header class="quiz-editor-header">
        <div class="quiz-editor-title">${ICONS.clipboard}<span>随堂测验</span><small class="quiz-editor-progress">1 题</small></div>
        <button class="quiz-editor-close" type="button" title="暂时收起" aria-label="暂时收起测验编辑器">${ICONS.close}</button>
      </header>
      <div class="quiz-editor-meta">
        <span class="quiz-editor-knowledge">检查理解</span>
        <span class="quiz-editor-difficulty">难度 1 / 5</span>
      </div>
      <div class="quiz-editor-body">
        <div class="quiz-editor-question"></div>
        <div class="quiz-editor-answer" role="group" aria-label="选择答案"></div>
        <div class="quiz-editor-feedback" role="status" aria-live="polite" hidden></div>
      </div>
      <footer class="quiz-editor-actions">
        <span class="quiz-editor-hint">选择答案后提交</span>
        <button class="btn-primary quiz-submit" type="button" disabled>提交答案</button>
      </footer>`;
    const view = document.getElementById('view');
    (view?.parentElement || document.body).appendChild(panel);
    this._el = panel;

    panel.querySelector('.quiz-editor-close').addEventListener('click', () => this.close({ preservePending: true }));
    panel.querySelector('.quiz-submit').addEventListener('click', () => void this.submit());
    this._initResize(panel.querySelector('.quiz-resize-handle'));
  },

  _initResize(handle) {
    const resizeFromKeyboard = delta => {
      const current = this._el.getBoundingClientRect().height;
      const maximum = Math.max(260, Math.min(620, (this._el.parentElement?.clientHeight || window.innerHeight) - 170));
      this._el.style.setProperty('--quiz-panel-height', `${Math.min(maximum, Math.max(240, current + delta))}px`);
    };
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      resizeFromKeyboard(event.key === 'ArrowUp' ? 24 : -24);
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = this._el.getBoundingClientRect().height;
      const maximum = Math.max(260, Math.min(620, (this._el.parentElement?.clientHeight || window.innerHeight) - 170));
      const move = moveEvent => {
        const height = Math.min(maximum, Math.max(240, startHeight + startY - moveEvent.clientY));
        this._el.style.setProperty('--quiz-panel-height', `${height}px`);
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop, { once: true });
    });
  },

  open(quiz, subjectId = state.currentSubject) {
    if (!quiz || !['choice', 'fill'].includes(quiz.type)) return;
    this._ensure();
    practicePanel.close({ preservePending: true });
    this._quiz = quiz;
    this._subjectId = subjectId;
    this._selectedAnswer = null;
    this._submitted = false;
    this._attempts = Math.max(0, Number(quiz.attempt_count) || 0);

    const panel = this._el;
    panel.querySelector('.quiz-editor-progress').textContent = this._attempts
      ? `第 ${this._attempts + 1} 次作答`
      : '1 题';
    panel.querySelector('.quiz-editor-knowledge').textContent = quiz.knowledge_point || '检查理解';
    panel.querySelector('.quiz-editor-difficulty').textContent = `难度 ${Math.min(5, Math.max(1, quiz.difficulty || 1))} / 5`;
    renderQuestionContent(panel.querySelector('.quiz-editor-question'), quiz.question || '请完成这道题');
    const answerEl = panel.querySelector('.quiz-editor-answer');
    answerEl.replaceChildren();
    answerEl.setAttribute('aria-label', quiz.type === 'choice' ? '选择答案' : '填写答案');

    if (quiz.type === 'choice') {
      (quiz.options || []).forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quiz-editor-option';
        button.dataset.index = String(index);
        button.innerHTML = `<span>${String.fromCharCode(65 + index)}</span><strong>${escapeHtml(String(option).replace(/^[A-ZＡ-Ｚ][.、]\s*/i, ''))}</strong>`;
        button.addEventListener('click', () => this.select(index));
        answerEl.appendChild(button);
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.className = 'quiz-editor-input';
      textarea.rows = 4;
      textarea.placeholder = '在这里写下答案';
      textarea.setAttribute('aria-label', '填写测验答案');
      textarea.addEventListener('input', () => this.select(textarea.value));
      textarea.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); void this.submit(); }
      });
      answerEl.appendChild(textarea);
    }

    panel.querySelector('.quiz-editor-feedback').hidden = true;
    panel.querySelector('.quiz-editor-feedback').replaceChildren();
    const submit = panel.querySelector('.quiz-submit');
    submit.disabled = true;
    submit.textContent = '提交答案';
    panel.querySelector('.quiz-editor-hint').textContent = quiz.type === 'choice' ? '选择一个答案后提交' : '填写后按 Ctrl+Enter 提交';
    panel.classList.add('open');
    setTimeout(() => panel.querySelector('button.quiz-editor-option, .quiz-editor-input')?.focus(), 50);
  },

  select(answer) {
    if (this._submitted) return;
    this._selectedAnswer = answer;
    this._el.querySelectorAll('.quiz-editor-option.is-wrong').forEach(button => button.classList.remove('is-wrong'));
    if (this._quiz?.type === 'choice') {
      this._el.querySelectorAll('.quiz-editor-option').forEach(button => {
        button.classList.toggle('selected', Number(button.dataset.index) === Number(answer));
        button.setAttribute('aria-pressed', String(Number(button.dataset.index) === Number(answer)));
      });
    }
    const result = evaluateQuizAnswer(this._quiz, answer);
    this._el.querySelector('.quiz-submit').disabled = !result.valid;
  },

  async submit() {
    if (this._submitted || !this._quiz || !this._subjectId) return;
    const result = evaluateQuizAnswer(this._quiz, this._selectedAnswer);
    if (!result.valid) {
      this._el.querySelector('.quiz-editor-hint').textContent = result.reason;
      return;
    }
    releaseStudentVoiceTurn();
    this._attempts += 1;
    const attemptPolicy = planQuizAttempt(this._quiz, result, this._attempts);
    this._submitted = attemptPolicy.complete;
    const correctAnswer = getQuizCorrectAnswer(this._quiz);
    this._el.querySelectorAll('button.quiz-editor-option, .quiz-editor-input').forEach(control => { control.disabled = true; });
    const feedback = this._el.querySelector('.quiz-editor-feedback');
    feedback.hidden = false;
    feedback.className = `quiz-editor-feedback is-${attemptPolicy.tone}`;
    setIconText(
      feedback,
      result.correct ? ICONS.check : (attemptPolicy.retry ? ICONS.lightbulb : ICONS.xMark),
      attemptPolicy.message,
    );
    requestAnimationFrame(() => feedback.scrollIntoView({ block: 'nearest' }));
    const submit = this._el.querySelector('.quiz-submit');
    submit.disabled = true;
    submit.textContent = attemptPolicy.retry ? '再次提交' : '已完成';
    this._el.querySelector('.quiz-editor-progress').textContent = attemptPolicy.retry
      ? `第 ${this._attempts + 1} 次作答`
      : `${this._attempts} 次作答完成`;
    this._el.querySelector('.quiz-editor-hint').textContent = attemptPolicy.retry
      ? '根据提示修改后再提交'
      : result.correct ? '老师正在根据本次表现继续课堂' : '老师正在针对卡点补讲';

    await logLearningEvent(this._subjectId, 'quiz_answer', [this._quiz.knowledge_point || ''], {
      correct: result.correct,
      type: this._quiz.type,
      attempt: this._attempts,
      hintUsed: this._attempts > 1,
    });
    if (!result.correct && this._attempts === 1) {
      invoke('save_mistake', {
        subjectId: this._subjectId,
        knowledgePoint: this._quiz.knowledge_point || '',
        question: this._quiz.question || '',
        studentAnswer: this._quiz.type === 'choice'
          ? String((this._quiz.options || [])[Number(result.answer)] ?? result.answer)
          : String(result.answer),
        correctAnswer,
        errorType: 'unclassified_quiz_error',
      }).catch(() => {});
    }
    const answerText = this._quiz.type === 'choice'
      ? String((this._quiz.options || [])[Number(result.answer)] ?? result.answer)
      : String(result.answer);
    await commitQuizEvidence?.({
      subjectId: this._subjectId,
      knowledgePoint: this._quiz.knowledge_point || '当前检查点',
      correct: result.correct,
      answer: answerText,
      correctAnswer,
      attempt: this._attempts,
      question: this._quiz.question || '',
      explanation: this._quiz.explanation || '',
    });

    if (attemptPolicy.retry) {
      this._submitted = false;
      if (this._quiz.type === 'choice') {
        const selected = this._el.querySelector(`.quiz-editor-option[data-index="${Number(result.answer)}"]`);
        selected?.classList.add('is-wrong');
      }
      this._el.querySelectorAll('button.quiz-editor-option, .quiz-editor-input').forEach(control => { control.disabled = false; });
      const retryQuiz = { ...this._quiz, attempt_count: this._attempts };
      await persistTeachingSession(this._subjectId, {
        pendingAction: { type: 'show_quiz', quiz: retryQuiz },
      });
      this._el.querySelector('button.quiz-editor-option:not(.selected), .quiz-editor-input')?.focus();
      return;
    }
    await persistTeachingSession(this._subjectId, { pendingAction: null });
  },

  close({ preservePending = true } = {}) {
    this._el?.classList.remove('open');
    if (!preservePending && this._subjectId) void persistTeachingSession(this._subjectId, { pendingAction: null });
  },
};

// ============ 学习事件追踪 ============
async function logLearningEvent(subjectId, eventType, knowledgePoints = [], detail = {}) {
  try {
    await invoke('save_learning_event', {
      subjectId: subjectId || '',
      eventType,
      knowledgePointsJson: JSON.stringify(knowledgePoints),
      detailJson: JSON.stringify(detail),
    });
  } catch (e) {
    console.warn('记录学习事件失败:', e);
  }
}

// ============ 结构化输出处理 ============
async function verifyStudentStateUpdate(subjectId, raw) {
  if (!subjectId || !raw) return null;
  try {
    const points = await invoke('get_knowledge_points', { subjectId });
    const requestedName = String(raw.knowledge_point || '').trim();
    const existing = (points || []).find(point => point.name === requestedName);
    return normalizeStudentStateUpdate(raw, existing?.mastery || 0);
  } catch (error) {
    console.warn('校验教师学情判断失败:', error);
    return null;
  }
}

async function resolveCanonicalComponent(subjectId, knowledgePoint) {
  const components = await invoke('get_canonical_knowledge_components', { subjectId }).catch(() => []);
  const target = String(knowledgePoint || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  return components.find(component => String(component.name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase() === target)
    || null;
}

async function appendInstructionEvidence({ subjectId, knowledgePoint, structured, teacherBrief, studentUpdate, task }) {
  const instructionValid = structured?.instruction_contract?.valid === true;
  if (!instructionValid && !studentUpdate) return false;
  const component = await resolveCanonicalComponent(subjectId, knowledgePoint);
  if (!component) return false;
  const phase = teacherBrief?.lessonStep?.phase || teacherBrief?.phase || '';
  const supportLevel = studentUpdate?.supportLevel || studentUpdate?.support_level || 'none';
  const correct = studentUpdate ? Number(studentUpdate.delta) > 0 : null;
  const stage = deriveTaskEvidenceStage({
    instructionValid,
    studentUpdate,
    task,
    lessonPhase: phase,
  });
  if (!stage) return false;
  const taskKey = task?.key || (stage === 'introduced' ? `instruction:${component.canonical_key}:${Date.now()}` : '');
  const source = stage === 'introduced'
    ? 'instruction_block'
    : task?.kind === 'practice' ? 'lesson_ledger' : 'independent_verifier';
  const evidenceKey = [subjectId, component.canonical_key, stage, taskKey,
    studentUpdate?.evidence || structured?.message || '', Date.now()].join('|').slice(0, 500);
  return invoke('append_knowledge_evidence', {
    evidenceKey,
    subjectId,
    canonicalKey: component.canonical_key,
    stage,
    taskKey,
    source,
    supportLevel: stage === 'introduced' ? 'none' : (supportLevel === 'prompted' ? 'prompted' : 'none'),
    correct,
    evidenceExcerpt: String(studentUpdate?.evidence || structured?.message || '').slice(0, 500),
    delayHours: 0,
    trusted: stage === 'introduced' ? instructionValid : Boolean(studentUpdate),
  }).catch(error => {
    console.warn('分级教学证据保存失败:', error);
    return false;
  });
}

async function persistVerifiedStudentStateUpdate(subjectId, update) {
  if (!subjectId || !update) return;
  try {
    await invoke('add_knowledge_point', {
      subjectId,
      name: update.knowledgePoint,
      description: `AI 教师判断依据：${update.evidence}`,
      mastery: update.mastery,
    });
    await logLearningEvent(subjectId, 'teacher_assessment', [update.knowledgePoint], {
      before: update.before,
      after: update.mastery,
      delta: update.delta,
      confidence: update.confidence,
      evidence: update.evidence,
      supportLevel: update.supportLevel,
    });
  } catch (error) {
    console.warn('保存教师学情判断失败:', error);
  }
}

async function handleStructuredResponse(structured, messagesEl, subjectId, verifiedStudentStateUpdate = null) {
  if (!structured) return;

  if (structured.lesson_summary && subjectId && !state.teachingSessions[subjectId]?.activeIntervention) {
    const session = state.teachingSessions[subjectId] || {};
    const summary = normalizeLessonSummary(
      structured.lesson_summary,
      session.lessonPlan,
      session.lessonProgress,
    );
    if (summary) {
      const history = Array.isArray(session.lessonHistory) ? session.lessonHistory.slice(-5) : [];
      history.push({ ...summary, recorded_at: new Date().toISOString() });
      let learnerProfile = session.learnerProfile || null;
      try {
        const [points, mistakes, events] = await Promise.all([
          invoke('get_knowledge_points', { subjectId }),
          invoke('get_mistakes', { subjectId }),
          invoke('get_learning_events', { subjectId }),
        ]);
        learnerProfile = buildLearnerProfile(
          points, mistakes, events, summary, new Date(), session.teachingPreferences,
        );
      } catch (error) {
        console.warn('更新长期学生画像失败:', error);
      }
      await persistTeachingSession(subjectId, {
        lastLessonSummary: summary,
        lessonHistory: history,
        reviewSchedule: summary.review,
        learnerProfile,
      });
      await logLearningEvent(
        subjectId,
        'lesson_summary',
        [...summary.mastered, ...summary.needs_work].map(item => item.knowledge_point),
        summary,
      );
    }
  }

  if (structured.homework_update && subjectId) {
    const pendingHomework = state.teachingSessions[subjectId]?.pendingHomework;
    const update = normalizeHomeworkUpdate(structured.homework_update, pendingHomework);
    if (update) {
      try {
        await invoke('update_homework_status', { homeworkId: update.homeworkId, status: 'graded', studentAnswer: null, grade: update.grade });
        await logLearningEvent(subjectId, 'homework_graded', [], { homeworkId: update.homeworkId, title: pendingHomework.title });
        await persistTeachingSession(subjectId, { pendingHomework: null });
        showToast('老师已完成作业批改', 'success');
      } catch (error) {
        console.warn('保存作业批改失败:', error);
      }
    }
  }

  if (verifiedStudentStateUpdate) {
    await persistVerifiedStudentStateUpdate(subjectId, verifiedStudentStateUpdate);
  }

  if (structured.visual) renderTeachingVisual(structured.visual, messagesEl);

  // 处理 actions
  if (structured.actions && structured.actions.length > 0) {
    await persistTeachingSession(subjectId, { pendingAction: structured.actions[0] });
    for (const action of structured.actions) {
      if (action.type === 'open_practice_panel' && action.practice) {
        await practicePanel.open(action.practice);
      }
      if (action.type === 'show_quiz' && action.quiz) {
        quizPanel.open(action.quiz, subjectId);
      }
    }
  }

  // 处理 state 变化 — 在消息流中显示状态标签
  if (structured.state) {
    const stateLabels = {
      prepare: { icon: ICONS.clipboard, label: '准备中' },
      explain: { icon: ICONS.book, label: '讲解' },
      check: { icon: ICONS.helpCircle, label: '检查理解' },
      practice: { icon: ICONS.code, label: '动手练习' },
      run_code: { icon: ICONS.run, label: '运行代码' },
      feedback: { icon: ICONS.messageSquare, label: '反馈' },
      quiz: { icon: ICONS.clipboard, label: '小测' },
      next_step: { icon: ICONS.arrowRight, label: '下一步' },
      summary: { icon: ICONS.barChart, label: '总结' },
    };
    const stateMeta = stateLabels[structured.state];
    if (stateMeta && messagesEl) {
      const tag = document.createElement('div');
      tag.className = 'lesson-state-tag';
      setIconText(tag, stateMeta.icon, stateMeta.label);
      messagesEl.appendChild(tag);
      if ($('#statusLesson')) $('#statusLesson').textContent = stateMeta.label;
      const session = state.teachingSessions[subjectId] || {};
      const teacherPhase = document.getElementById('teacherPhase');
      if (teacherPhase && !session.lessonPlan) teacherPhase.textContent = stateMeta.label;
      updateLessonRhythm(session.lessonPlan ? session.brief?.lessonStep?.phase : structured.state);
      if (!session.lessonPlan) {
        await persistTeachingSession(subjectId, {
          brief: { ...(session.brief || {}), phase: structured.state, phaseLabel: stateMeta.label },
        });
      }
    }
  }
}

// ============ DOM 工具 ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
  // 每个步骤独立 try-catch，一个失败不影响其他
  // 命令注册表最先初始化，确保菜单和命令面板可用
  safeCall('initTitlebar', initTitlebar);
  safeCall('initCommandRegistry', initCommandRegistry);
  safeCall('initDesktopShell', initDesktopShell);
  safeCall('initDesktopMenus', initDesktopMenus);
  safeCall('initRibbon', initRibbon);
  safeCall('initSidebar', initSidebar);
  safeCall('initRightPanel', initRightPanel);
  safeCall('initCommandPalette', initCommandPalette);
  safeCall('initTeacherVoiceLifecycle', initTeacherVoiceLifecycle);
  safeCall('switchView', () => switchView('chat'));

  // 加载配置
  try {
    APP_CONFIG = await invoke('get_config');
  } catch (e) {
    console.warn('读取配置失败，使用默认值:', e);
  }

  // 更新状态栏
  try { $('#statusModel').textContent = APP_CONFIG.models.chat; } catch {}

  // 恢复界面偏好
  try {
    const savedTheme = localStorage.getItem('warmclassroom.theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    const savedFontSize = localStorage.getItem('warmclassroom.fontSize');
    if (savedFontSize) document.documentElement.setAttribute('data-font-size', savedFontSize);
  } catch {}

  // 加载科目列表
  try {
    await loadSubjects();
    // 首次渲染侧栏时科目尚未加载；加载完成后必须刷新一次。
    if (state.currentView === 'chat') updateSidebarForView('chat');
    if (state.subjects.length > 0) {
      selectSubject(state.subjects[0].id);
    }
  } catch (e) {
    console.warn('加载科目失败:', e);
  }

  // API 健康检查（后台）
  checkApiConnection();
});

function safeCall(name, fn) {
  try { fn(); } catch (e) {
    console.warn(name + ' 初始化失败:', e);
    showToast(`${name} 初始化失败`, 'error');
  }
}

// ============ Toast 通知 ============
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============ 桌面工作台交互 ============

// 布局 toggle 函数（独立定义，供命令注册表和桌面 shell 共用）
function _setLayoutCollapsed(which, collapsed) {
  const shell = $('#workbench');
  if (!shell) return;
  if (which === 'sidebar') {
    state.sidebarCollapsed = collapsed;
    shell.classList.toggle('sidebar-collapsed', collapsed);
    $('#sidebarToggle')?.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(LAYOUT_KEYS.sidebarCollapsed, String(collapsed)); } catch {}
  } else {
    state.rightPanelCollapsed = collapsed;
    shell.classList.toggle('inspector-collapsed', collapsed);
    $('#inspectorToggle')?.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(LAYOUT_KEYS.inspectorCollapsed, String(collapsed)); } catch {}
  }
}

function initCommandRegistry() {
  if (commandRegistry) return; // 防止重复初始化

  const resumeLearning = () => {
    const subjectId = state.currentSubject || state.subjects[0]?.id;
    if (subjectId) selectSubject(subjectId);
  };

  commandRegistry = createCommandRegistry({
    newSubject: () => { switchView('chat'); addNewSubject(); },
    closeTab: () => { if (state.activeTab) closeTab(state.activeTab); },
    canCloseTab: () => Boolean(state.activeTab),
    openClassroom: () => switchView('chat'),
    openNotes: () => switchView('notes'),
    openHomework: () => switchView('homework'),
    openReview: () => switchView('review'),
    openSettings: () => {
      switchView('settings');
      openTab('setting-set1', '模型设置', 'settings');
    },
    toggleSidebar: () => _setLayoutCollapsed('sidebar', !state.sidebarCollapsed),
    toggleInspector: () => _setLayoutCollapsed('inspector', !state.rightPanelCollapsed),
    openCommandCenter: () => toggleCommandPalette('open'),
    resumeLearning,
    openCurrentSubject: resumeLearning,
    canResumeLearning: () => Boolean(state.currentSubject || state.subjects.length),
    checkConnection: () => { void checkApiConnection(); },
    showShortcuts: () => showShortcutDialog(),
    showAbout: () => showInfoDialog('关于启思学堂', [
      '启思学堂 0.1.0',
      '学生端连续学习桌面应用',
      `当前模型：${APP_CONFIG.models.chat}`,
      '本地数据由 SQLite 保存。',
    ]),
    exitApp: () => { void getCurrentWindow().close(); },
  });
}

function initDesktopShell() {
  const shell = $('#workbench');
  if (!shell) return;

  // Desktop shortcuts: Ctrl+K, Ctrl+P, Ctrl+B, Ctrl+Shift+I, Ctrl+1…5
  const readLayoutValue = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const writeLayoutValue = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch { /* WebView storage unavailable */ }
  };

  const storedSidebarWidth = Number.parseInt(readLayoutValue(LAYOUT_KEYS.sidebarWidth), 10);
  const storedInspectorWidth = Number.parseInt(readLayoutValue(LAYOUT_KEYS.inspectorWidth), 10);
  if (Number.isFinite(storedSidebarWidth)) {
    document.documentElement.style.setProperty('--sidebar-width', `${Math.min(360, Math.max(200, storedSidebarWidth))}px`);
  }
  if (Number.isFinite(storedInspectorWidth)) {
    document.documentElement.style.setProperty('--inspector-width', `${Math.min(380, Math.max(240, storedInspectorWidth))}px`);
  }

  // 恢复布局折叠状态
  _setLayoutCollapsed('sidebar', readLayoutValue(LAYOUT_KEYS.sidebarCollapsed) === 'true');
  const storedInspectorCollapsed = readLayoutValue(LAYOUT_KEYS.inspectorCollapsed);
  let narrowWorkbench = window.innerWidth < 1050;
  const inspectorInitiallyCollapsed = narrowWorkbench || storedInspectorCollapsed === 'true';
  _setLayoutCollapsed('inspector', inspectorInitiallyCollapsed);
  window.addEventListener('resize', () => {
    const nextNarrowWorkbench = window.innerWidth < 1050;
    if (nextNarrowWorkbench && !narrowWorkbench) _setLayoutCollapsed('inspector', true);
    narrowWorkbench = nextNarrowWorkbench;
  });

  $('#sidebarToggle')?.addEventListener('click', () => _setLayoutCollapsed('sidebar', !state.sidebarCollapsed));
  $('#inspectorToggle')?.addEventListener('click', () => _setLayoutCollapsed('inspector', !state.rightPanelCollapsed));
  $('#rightClose')?.addEventListener('click', () => _setLayoutCollapsed('inspector', true));
  $('#statusCommand')?.addEventListener('click', () => $('#commandCenter')?.click());
  $('#view')?.addEventListener('click', event => {
    const action = event.target.closest('[data-workbench-action]')?.dataset.workbenchAction;
    if (action === 'new-subject') {
      switchView('chat');
      addNewSubject();
    }
    if (action === 'command-center') $('#commandCenter')?.click();
  });

  bindPanelResizer({
    element: $('#sidebarResizer'),
    cssVariable: '--sidebar-width',
    storageKey: LAYOUT_KEYS.sidebarWidth,
    min: 200,
    max: 360,
    direction: 1,
    writeLayoutValue,
  });
  bindPanelResizer({
    element: $('#inspectorResizer'),
    cssVariable: '--inspector-width',
    storageKey: LAYOUT_KEYS.inspectorWidth,
    min: 240,
    max: 380,
    direction: -1,
    writeLayoutValue,
  });

  document.addEventListener('keydown', (event) => {
    if (!commandRegistry?.handleKeydown(event)) return;
    event.preventDefault();
  });
}

function initDesktopMenus() {
  const popover = $('#desktopMenuPopover');
  const menuButtons = [...document.querySelectorAll('.menu-item[data-menu]')];
  if (!popover || !commandRegistry || !menuButtons.length) return;
  let activeButton = null;

  const closeMenu = (restoreFocus = false) => {
    popover.hidden = true;
    popover.innerHTML = '';
    menuButtons.forEach(button => {
      button.classList.remove('active');
      button.setAttribute('aria-expanded', 'false');
    });
    if (restoreFocus) activeButton?.focus();
    activeButton = null;
  };

  const openMenu = (button, focusFirst = false) => {
    activeButton = button;
    menuButtons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-expanded', String(active));
    });
    popover.innerHTML = '';

    for (const command of commandRegistry.forMenu(button.dataset.menu)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'desktop-menu-command';
      item.setAttribute('role', 'menuitem');
      item.dataset.commandId = command.id;
      item.disabled = !command.enabled;
      if (command.separatorBefore) item.classList.add('separator-before');

      const label = document.createElement('span');
      label.textContent = command.label;
      item.appendChild(label);
      if (command.kbd) {
        const shortcut = document.createElement('kbd');
        shortcut.textContent = command.kbd;
        item.appendChild(shortcut);
      }
      item.addEventListener('click', () => {
        if (commandRegistry.execute(command.id)) closeMenu();
      });
      popover.appendChild(item);
    }

    const rect = button.getBoundingClientRect();
    popover.style.left = `${Math.max(4, rect.left)}px`;
    popover.style.top = `${rect.bottom}px`;
    popover.hidden = false;
    if (focusFirst) popover.querySelector('.desktop-menu-command:not(:disabled)')?.focus();
  };

  menuButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      if (!popover.hidden && activeButton === button) closeMenu();
      else openMenu(button);
    });
    button.addEventListener('pointerenter', () => {
      if (!popover.hidden && activeButton !== button) openMenu(button);
    });
    button.addEventListener('keydown', event => {
      if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openMenu(button, true);
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = menuButtons[(index + direction + menuButtons.length) % menuButtons.length];
        next.focus();
        if (!popover.hidden) openMenu(next, true);
      }
      if (event.key === 'Escape') closeMenu(true);
    });
  });

  popover.addEventListener('keydown', event => {
    const items = [...popover.querySelectorAll('.desktop-menu-command:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + direction + items.length) % items.length]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  });

  document.addEventListener('pointerdown', event => {
    if (popover.hidden || popover.contains(event.target) || event.target.closest('.menu-item[data-menu]')) return;
    closeMenu();
  });
}

function showInfoDialog(title, lines) {
  $('#workbenchInfoDialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'workbenchInfoDialog';
  overlay.className = 'info-dialog-overlay';

  const dialog = document.createElement('section');
  dialog.className = 'info-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'workbenchInfoTitle');

  const heading = document.createElement('h2');
  heading.id = 'workbenchInfoTitle';
  heading.textContent = title;
  dialog.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'info-dialog-body';
  for (const line of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    body.appendChild(paragraph);
  }
  dialog.appendChild(body);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn-primary';
  closeButton.textContent = '关闭';
  dialog.appendChild(closeButton);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  closeButton.focus();
}

function showShortcutDialog() {
  const lines = commandRegistry
    .all()
    .filter(command => command.kbd)
    .map(command => `${command.label}  —  ${command.kbd}`);
  showInfoDialog('键盘快捷键', lines);
}

function bindPanelResizer({ element, cssVariable, storageKey, min, max, direction, writeLayoutValue }) {
  if (!element) return;
  const clamp = (value) => Math.min(max, Math.max(min, value));
  let startX = 0;
  let startWidth = 0;

  const applyWidth = (value) => {
    const width = clamp(Math.round(value));
    document.documentElement.style.setProperty(cssVariable, `${width}px`);
    element.setAttribute('aria-valuenow', String(width));
    writeLayoutValue(storageKey, width);
  };

  element.setAttribute('aria-valuemin', String(min));
  element.setAttribute('aria-valuemax', String(max));

  element.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVariable)) || min;
    element.classList.add('dragging');
    element.setPointerCapture?.(event.pointerId);
  });
  element.addEventListener('pointermove', (event) => {
    if (!element.classList.contains('dragging')) return;
    applyWidth(startWidth + (event.clientX - startX) * direction);
  });
  const finish = (event) => {
    if (!element.classList.contains('dragging')) return;
    element.classList.remove('dragging');
    element.releasePointerCapture?.(event.pointerId);
  };
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVariable)) || min;
    const delta = (event.key === 'ArrowRight' ? 8 : -8) * direction;
    applyWidth(current + delta);
  });
}

async function checkApiConnection() {
  updateConnectionStatus({ status: 'checking', message: '正在连接模型服务' });
  try {
    const health = await invoke('check_api_health', {
      baseUrl: APP_CONFIG.base_url,
      apiKey: APP_CONFIG.api_key,
      model: APP_CONFIG.models?.chat || '',
    });
    updateConnectionStatus(health);
    return health;
  } catch (e) {
    console.warn('API 检查失败:', e);
    const health = { status: 'transport_error', message: '无法调用连接检查' };
    updateConnectionStatus(health);
    return health;
  }
}

// ============ 标题栏 ============
function initTitlebar() {
  try {
    const appWindow = getCurrentWindow();
    const titlebar = document.querySelector('.titlebar');
    const isInteractiveTarget = target => Boolean(target.closest('button, nav, input, textarea, select, a, kbd, [role="menu"]'));
    titlebar?.addEventListener('pointerdown', event => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      void appWindow.startDragging().catch(error => console.warn('窗口拖动失败:', error));
    });
    titlebar?.addEventListener('dblclick', event => {
      if (isInteractiveTarget(event.target)) return;
      void appWindow.toggleMaximize();
    });
    $('#btnMinimize')?.addEventListener('click', () => appWindow.minimize());
    $('#btnMaximize')?.addEventListener('click', () => appWindow.toggleMaximize());
    $('#btnClose')?.addEventListener('click', () => appWindow.close());
  } catch (e) {
    console.warn('标题栏初始化失败（非 Tauri 环境？）:', e);
  }
}

// ============ 图标栏 ============
function initRibbon() {
  const ribbonTop = $('#ribbonTop');
  const ribbonBottom = $('#ribbonBottom');
  ['chat', 'notes', 'homework', 'review'].forEach(v => ribbonTop.appendChild(createRibButton(v)));
  ribbonBottom.appendChild(createRibButton('settings'));
}

function createRibButton(view) {
  const btn = document.createElement('button');
  const label = { chat: '课堂', notes: '笔记', homework: '作业', review: '复习', settings: '设置' }[view];
  btn.type = 'button';
  btn.className = 'rib-btn';
  btn.dataset.view = view;
  btn.innerHTML = ICONS[view];
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => switchView(view));
  return btn;
}

function switchView(view) {
  state.currentView = view;
  $$('.rib-btn').forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  // 像 Obsidian 一样：切换功能栏只更新侧栏，保留当前工作区标签。
  updateSidebarForView(view);
}

// ============ 侧栏 ============
function initSidebar() {
  $('#sidebarAdd')?.addEventListener('click', () => {
    if (state.currentView === 'chat') addNewSubject();
  });
}

function updateSidebarForView(view) {
  const title = $('#sidebarTitle');
  const body = $('#sidebarBody');
  const addBtn = $('#sidebarAdd');
  const contextLabel = document.querySelector('.context-label');
  body.innerHTML = '';

  switch (view) {
    case 'chat':
      title.textContent = '课堂';
      addBtn.style.display = 'flex';
      addBtn.setAttribute('aria-label', '新增科目');
      if (contextLabel) contextLabel.textContent = '科目';
      renderSubjectList(body);
      break;
    case 'notes':
      title.textContent = '笔记';
      addBtn.style.display = 'none';
      if (contextLabel) contextLabel.textContent = '学习笔记';
      renderNotesList(body);
      break;
    case 'homework':
      title.textContent = '作业';
      addBtn.style.display = 'none';
      if (contextLabel) contextLabel.textContent = '我的作业';
      renderHomeworkList(body);
      break;
    case 'review':
      title.textContent = '复习';
      addBtn.style.display = 'none';
      if (contextLabel) contextLabel.textContent = '复习资料';
      renderReviewList(body);
      break;
    case 'settings':
      title.textContent = '设置';
      addBtn.style.display = 'none';
      if (contextLabel) contextLabel.textContent = '应用设置';
      renderSettingsList(body);
      break;
  }
  const count = body.querySelectorAll('.list-item').length;
  if ($('#sidebarCount')) $('#sidebarCount').textContent = String(count);
}

// ============ 科目列表（从数据库加载） ============
async function loadSubjects() {
  try {
    const subjects = await invoke('get_subjects');
    state.subjects = subjects.map(subject => {
      const validation = validateSubjectName(subject.name);
      return {
        ...subject,
        rawName: subject.name,
        name: getDisplaySubjectName(subject.name),
        needsNaming: !validation.valid,
      };
    });
    if (subjects.length > 0 && !state.currentSubject) {
      state.currentSubject = subjects[0].id;
    }
  } catch (e) {
    console.warn('加载科目失败:', e);
    state.subjects = [];
  }
}

function renderSubjectList(container) {
  if (!state.subjects.length) {
    renderSidebarEmptyState(container, ICONS.book, '还没有科目', '点击下方按钮创建第一个科目。');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'sidebar-empty-action';
    action.innerHTML = `${ICONS.book}<span>新建科目</span>`;
    action.addEventListener('click', addNewSubject);
    container.querySelector('.sidebar-empty')?.appendChild(action);
    return;
  }
  state.subjects.forEach(subject => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `list-item ${subject.id === state.currentSubject ? 'active' : ''} ${subject.needsNaming ? 'needs-name' : ''}`;
    item.dataset.subjectId = subject.id;
    item.setAttribute('aria-label', `打开${subject.name}`);
    item.innerHTML = `
      <span class="li-avatar" aria-hidden="true">${getSubjectIcon(subject.id)}</span>
      <div class="li-text">
        <div class="li-name">${escapeHtml(subject.name)}</div>
        <div class="li-sub">${subject.needsNaming ? '需要补充学习方向并由 AI 命名' : escapeHtml(subject.description)}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      selectSubject(subject.id);
      if (subject.needsNaming) openSubjectRename(subject);
    });
    container.appendChild(item);
  });
}

function selectSubject(subjectId) {
  state.currentSubject = subjectId;
  $$('.list-item').forEach(item => item.classList.toggle('active', item.dataset.subjectId === subjectId));
  const subject = state.subjects.find(s => s.id === subjectId);
  if (!subject) return;

  if ($('#statusSubject')) $('#statusSubject').textContent = subject.name;
  if ($('#editorBreadcrumb')) {
    $('#editorBreadcrumb').innerHTML = `<span>课堂</span><span class="breadcrumb-separator">/</span><span>${escapeHtml(subject.name)}</span>`;
  }

  // 判断是否为编程类科目，显示/隐藏文件树 tab
  toggleFileTreeTab(isSubjectCoding(subject));

  // 判断是否需要摸底
  if (!subject.assessed) {
    openTab(`assess-${subjectId}`, `${subject.name} · 摸底`, 'assess');
  } else {
    openTab(`chat-${subjectId}`, subject.name, 'chat');
  }
  updateRightPanel(subject);
  if (subject.needsNaming) setTimeout(() => openSubjectRename(subject), 0);
}

function initTeacherVoiceLifecycle() {
  document.addEventListener('pointerdown', event => {
    if (isStudentResponseTarget(event.target)) markStudentVoiceTurn();
  }, true);
  document.addEventListener('input', event => {
    if (isStudentResponseTarget(event.target)) markStudentVoiceTurn();
  }, true);
  document.addEventListener('keydown', event => {
    if (isStudentResponseTarget(event.target)) {
      markStudentVoiceTurn();
    } else if (event.key === 'Tab') {
      setTimeout(() => {
        if (isStudentResponseTarget(document.activeElement)) markStudentVoiceTurn();
      }, 0);
    }
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      teacherVoice.stop();
    }
  });
  window.addEventListener('pagehide', () => {
    teacherVoice.stop();
  });
  window.addEventListener('beforeunload', () => {
    teacherVoice.stop();
  });
}

function addNewSubject() {
  // 打开新建科目对话框（分类快速选择 + AI 命名）
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog new-subject-modal">
      <h2>新建学习科目</h2>
      <p class="modal-desc">选择学习领域，AI 老师会帮你确定精准的科目名称。</p>
      <div class="subject-categories">
        <button class="cat-btn" data-cat="programming" data-icon="code">编程开发</button>
        <button class="cat-btn" data-cat="math" data-icon="barChart">数学</button>
        <button class="cat-btn" data-cat="language" data-icon="messageSquare">语言学习</button>
        <button class="cat-btn" data-cat="design" data-icon="palette">设计创作</button>
        <button class="cat-btn" data-cat="science" data-icon="cpu">科学技术</button>
        <button class="cat-btn" data-cat="other" data-icon="book">其他</button>
      </div>
      <div class="cat-detail" id="catDetail" style="display:none">
        <div class="cat-presets" id="catPresets"></div>
        <div class="cat-custom">
          <input id="customSubjectInput" type="text" placeholder="或者输入你想学的具体方向..." autocomplete="off" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="cancelSubject" type="button">取消</button>
          <button class="btn-primary" id="confirmSubject" type="button">开始学习</button>
        </div>
        <div id="subjectFeedback" class="modal-feedback"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const presets = {
    programming: [
      { label: 'Python 入门到进阶', desc: '从零开始学 Python' },
      { label: 'JavaScript 前端开发', desc: 'Web 前端核心技术' },
      { label: 'Java 后端开发', desc: '企业级后端开发' },
      { label: '算法与数据结构', desc: '面试必备算法题' },
      { label: 'C/C++ 系统编程', desc: '底层系统开发' },
      { label: '数据库与 SQL', desc: '关系型数据库' },
    ],
    math: [
      { label: '二次函数学习', desc: '初中数学核心' },
      { label: '高中数学复习', desc: '高考数学冲刺' },
      { label: '微积分入门', desc: '大学高等数学' },
      { label: '线性代数', desc: '矩阵与向量空间' },
      { label: '概率论与统计', desc: '数据分析基础' },
      { label: '数学竞赛训练', desc: '奥数思维提升' },
    ],
    language: [
      { label: '英语日常口语', desc: '实用英语对话' },
      { label: '英语语法进阶', desc: '系统语法学习' },
      { label: '日语入门', desc: '从五十音开始' },
      { label: '写作与表达', desc: '提升写作能力' },
    ],
    design: [
      { label: 'UI/UX 设计入门', desc: '界面设计基础' },
      { label: '平面设计基础', desc: '设计原理与实践' },
      { label: 'Figma 设计实战', desc: '工具+实战' },
    ],
    science: [
      { label: '高中物理学习', desc: '力学电学热学' },
      { label: '高中化学学习', desc: '化学反应原理' },
      { label: 'AI 与机器学习入门', desc: '人工智能基础' },
    ],
    other: [],
  };

  let selectedCat = null;

  overlay.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCat = btn.dataset.cat;
      const icon = btn.dataset.icon;
      const detail = overlay.querySelector('#catDetail');
      const presetsEl = overlay.querySelector('#catPresets');
      const input = overlay.querySelector('#customSubjectInput');

      overlay.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));

      const items = presets[selectedCat] || [];
      presetsEl.innerHTML = items.map(p => `
        <button class="preset-btn" type="button">
          <span class="preset-label">${p.label}</span>
          <span class="preset-desc">${p.desc}</span>
        </button>
      `).join('');

      presetsEl.querySelectorAll('.preset-btn').forEach(pb => {
        pb.addEventListener('click', () => {
          presetsEl.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
          pb.classList.add('active');
          input.value = pb.querySelector('.preset-label').textContent;
        });
      });

      detail.style.display = 'flex';
      if (items.length === 0) input.focus();
    });
  });

  overlay.querySelector('#cancelSubject').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#confirmSubject').addEventListener('click', async () => {
    const input = overlay.querySelector('#customSubjectInput');
    const feedback = overlay.querySelector('#subjectFeedback');
    const userHint = input.value.trim();
    const hintValidation = validateSubjectName(userHint);
    if (!hintValidation.valid) {
      feedback.textContent = `${hintValidation.reason}，例如“Python 数据分析”或“初中一元一次方程”`;
      input.focus();
      return;
    }

    const confirmBtn = overlay.querySelector('#confirmSubject');
    confirmBtn.disabled = true;
    feedback.textContent = '正在让 AI 老师确定科目名称...';

    try {
      const identity = await generateSubjectIdentity(userHint, selectedCat || 'other');
      if (!identity.valid) throw new Error(identity.reason);
      selectedCat = identity.category || selectedCat || 'other';

      const id = 'sub_' + Date.now();
      await invoke('add_subject', { id, name: identity.name, icon: selectedCat || 'book', description: identity.description, category: selectedCat || 'other' });
      state.subjects.push({
        id, name: identity.name, rawName: identity.name, icon: selectedCat || 'book', description: identity.description,
        assessed: false, category: selectedCat, needsNaming: false,
      });
      invoke('load_knowledge_graph', { subjectId: id }).catch(() => {});
      overlay.remove();
      selectSubject(id);
      updateSidebarForView('chat');
    } catch (e) {
      // AI 命名失败时不要堵死学习入口：学生自己输入的名称本身就是可用的科目名。
      if (hintValidation.valid) {
        try {
          const id = 'sub_' + Date.now();
          await invoke('add_subject', { id, name: hintValidation.name, icon: selectedCat || 'book', description: `学习${hintValidation.name}相关内容。`, category: selectedCat || 'other' });
          state.subjects.push({
            id, name: hintValidation.name, rawName: hintValidation.name, icon: selectedCat || 'book', description: `学习${hintValidation.name}相关内容。`,
            assessed: false, category: selectedCat || 'other', needsNaming: false,
          });
          invoke('load_knowledge_graph', { subjectId: id }).catch(() => {});
          overlay.remove();
          selectSubject(id);
          updateSidebarForView('chat');
          return;
        } catch (fallbackError) {
          e = fallbackError;
        }
      }
      feedback.textContent = `无法创建：${typeof e === 'string' ? e : e.message}`;
      confirmBtn.disabled = false;
    }
  });
}

// ============ 笔记列表 ============
async function renderNotesList(container) {
  const subjectId = state.currentSubject;
  if (!subjectId) return renderSidebarEmptyState(container, ICONS.notes, '选择一个科目', '笔记按当前科目整理。');
  try {
    const notes = await invoke('get_notes', { subjectId });
    if (!notes.length) return renderSidebarEmptyState(container, ICONS.notes, '还没有笔记', '课堂中保存的笔记会出现在这里。');
    notes.forEach(note => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-item';
      item.innerHTML = `<span class="li-avatar" aria-hidden="true">${ICONS.notes}</span><div class="li-text"><div class="li-name">${escapeHtml(note.title)}</div><div class="li-sub">${escapeHtml((note.content || '').slice(0, 36) || '空白笔记')}</div></div>`;
      item.addEventListener('click', () => {
        state.selectedNoteId = note.id;
        openTab(`note-${subjectId}`, '学习笔记', 'note');
      });
      container.appendChild(item);
    });
    if ($('#sidebarCount')) $('#sidebarCount').textContent = String(notes.length);
  } catch (error) {
    renderSidebarEmptyState(container, ICONS.warning, '笔记加载失败', String(error));
  }
}

async function generateSubjectIdentity(userHint, category = 'other') {
  const namingMessages = JSON.stringify(buildSubjectNamingMessages(userHint, category));
  const requestId = crypto.randomUUID();
  let aiResponse = '';
  let namingDone = false;
  const unlistenNaming = await listen('chat-stream', event => {
    if (event.payload.requestId !== requestId) return;
    if (event.payload.type === 'content') aiResponse += event.payload.text;
    if (event.payload.type === 'done') namingDone = true;
  });
  try {
    await invoke('send_chat_stream', {
      baseUrl: APP_CONFIG.base_url,
      apiKey: APP_CONFIG.api_key,
      model: APP_CONFIG.models.fast || APP_CONFIG.models.chat,
      messagesJson: namingMessages,
      requestId,
    });
  } finally {
    unlistenNaming();
  }
  if (!namingDone && !aiResponse) return { valid: false, reason: 'AI 没有返回名称，请检查模型连接' };
  return parseSubjectNamingResponse(aiResponse);
}

function refreshRenamedSubject(subject) {
  for (const tab of state.tabs) {
    if (tab.id === `chat-${subject.id}`) tab.title = subject.name;
    if (tab.id === `assess-${subject.id}`) tab.title = `${subject.name} · 摸底`;
  }
  renderTabs();
  if (state.currentView === 'chat') updateSidebarForView('chat');
  if (state.currentSubject === subject.id) {
    $('#statusSubject').textContent = subject.name;
    updateRightPanel(subject);
    const activeTab = state.tabs.find(tab => tab.id === state.activeTab);
    if (activeTab) renderTabContent(activeTab);
  }
}

function openSubjectRename(subject) {
  if (!subject?.needsNaming || document.querySelector('.subject-rename-modal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog new-subject-modal subject-rename-modal" role="dialog" aria-modal="true" aria-labelledby="renameSubjectTitle">
      <h2 id="renameSubjectTitle">完善课程名称</h2>
      <p class="modal-desc">原名称无法说明学习内容。告诉 AI 你具体想学什么、准备用在哪里或希望达到什么目标。</p>
      <label class="rename-subject-field">学习内容与目标
        <textarea id="renameSubjectHint" rows="3" placeholder="例如：从零学习初中一元一次方程，希望能独立完成应用题"></textarea>
      </label>
      <div id="renameSubjectFeedback" class="modal-feedback" role="status" aria-live="polite"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancelRenameSubject" type="button">稍后处理</button>
        <button class="btn-primary" id="confirmRenameSubject" type="button">让 AI 生成名称</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#renameSubjectHint');
  const feedback = overlay.querySelector('#renameSubjectFeedback');
  const confirm = overlay.querySelector('#confirmRenameSubject');
  overlay.querySelector('#cancelRenameSubject').addEventListener('click', () => overlay.remove());
  confirm.addEventListener('click', async () => {
    const hint = input.value.trim();
    const hintValidation = validateSubjectName(hint);
    if (!hintValidation.valid) { feedback.textContent = `${hintValidation.reason}，例如“初中一元一次方程”`; input.focus(); return; }
    confirm.disabled = true;
    feedback.textContent = 'AI 正在整理课程名称…';
    try {
      const identity = await generateSubjectIdentity(hint, subject.category || 'other');
      if (!identity.valid) throw new Error(identity.reason);
      await invoke('rename_subject', {
        subjectId: subject.id,
        name: identity.name,
        description: identity.description,
        icon: identity.category || subject.icon || 'book',
      });
      Object.assign(subject, {
        name: identity.name, rawName: identity.name, description: identity.description,
        icon: identity.category || subject.icon || 'book', needsNaming: false,
      });
      overlay.remove();
      refreshRenamedSubject(subject);
      showToast(`课程已命名为“${identity.name}”`, 'success');
    } catch (error) {
      // AI 命名失败时同样直接采用学生输入的名称，避免命名环节阻塞学习。
      if (hintValidation.valid) {
        try {
          await invoke('rename_subject', {
            subjectId: subject.id,
            name: hintValidation.name,
            description: `学习${hintValidation.name}相关内容。`,
            icon: subject.icon || 'book',
            category: subject.category || 'other',
          });
          Object.assign(subject, {
            name: hintValidation.name, rawName: hintValidation.name, description: `学习${hintValidation.name}相关内容。`,
            needsNaming: false,
          });
          overlay.remove();
          refreshRenamedSubject(subject);
          showToast(`课程已命名为“${hintValidation.name}”`, 'success');
          return;
        } catch (fallbackError) {
          error = fallbackError;
        }
      }
      feedback.textContent = `暂时无法命名：${typeof error === 'string' ? error : error.message}`;
      confirm.disabled = false;
    }
  });
  input.focus();
}

function renderTeachingVisual(visual, messagesEl) {
  if (!visual || typeof visual !== 'object' || !messagesEl) return;
  const items = Array.isArray(visual.items) ? visual.items.slice(0, 8)
    : Array.isArray(visual.steps) ? visual.steps.slice(0, 8)
      : Array.isArray(visual.nodes) ? visual.nodes.slice(0, 8) : [];
  if (!items.length) return;
  const section = document.createElement('section');
  section.className = `teaching-visual teaching-visual-${['steps', 'comparison', 'concept'].includes(visual.type) ? visual.type : 'concept'}`;
  const heading = document.createElement('h3');
  heading.textContent = String(visual.title || '知识图示');
  section.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'teaching-visual-items';
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'teaching-visual-item';
    const marker = document.createElement('span');
    marker.className = 'teaching-visual-marker';
    marker.textContent = String(index + 1);
    const text = document.createElement('span');
    text.textContent = typeof item === 'string' ? item : String(item.label || item.title || item.content || '');
    row.append(marker, text);
    list.appendChild(row);
  });
  section.appendChild(list);
  messagesEl.appendChild(section);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function persistTeachingSession(subjectId, patch = {}) {
  if (!subjectId) return;
  const current = state.teachingSessions[subjectId] || {};
  const session = { ...current, ...patch, updatedAt: new Date().toISOString() };
  state.teachingSessions[subjectId] = session;
  try {
    await invoke('save_teaching_session', { subjectId, sessionJson: JSON.stringify(session) });
  } catch (error) {
    console.warn('保存连续课堂状态失败:', error);
  }
}

function parseStoredLessonPlan(record) {
  if (!record) return null;
  try {
    return normalizeLessonPlan(JSON.parse(record.lesson_json || record.lessonJson || '{}'));
  } catch {
    return null;
  }
}

async function ensureLessonPlan({
  subjectId, subjectName, assessed, currentLesson, knowledgePoints, recentEvents, mistakes = [],
  lastLessonSummary = null, teachingPreferences = null, nextLessonFocus = '',
}) {
  const stored = parseStoredLessonPlan(currentLesson);
  if (stored || !assessed) return { plan: stored, currentLesson, created: false };
  const orderedPoints = [...(knowledgePoints || [])].sort((a, b) => Number(a.mastery || 0) - Number(b.mastery || 0));
  const learnerProfile = buildLearnerProfile(
    knowledgePoints, mistakes, recentEvents, lastLessonSummary, new Date(), teachingPreferences,
  );
  const provisionalBrief = buildTeacherBrief({
    subjectName, assessed, knowledgePoints, recentEvents, currentLesson, learnerProfile,
    teachingPreferences, teachingMemory: learnerProfile.teachingMemory,
  });
  const plannedFocus = String(nextLessonFocus || learnerProfile.nextFocus || provisionalBrief.focus || '').trim();
  const learningProfile = {
    subject: subjectName,
    weakest_points: orderedPoints.slice(0, 3).map(point => ({ name: point.name, mastery: Number(point.mastery || 0) })),
    recent_events: (recentEvents || []).slice(0, 6).map(event => ({
      type: event.event_type,
      knowledge_points: event.knowledge_points_json,
      detail: event.detail_json,
    })),
    suggested_focus: plannedFocus,
    longitudinal_profile: learnerProfile,
  };
  let plan = null;
  try {
    const generated = await invoke('generate_lesson_plan', {
      baseUrl: APP_CONFIG.base_url,
      apiKey: APP_CONFIG.api_key,
      model: APP_CONFIG.models.chat,
      subject: subjectName,
      learningProfileJson: JSON.stringify(learningProfile),
    });
    plan = normalizeLessonPlan(JSON.parse(generated), {
      subjectName, focus: plannedFocus, objective: provisionalBrief.goal,
    });
  } catch (error) {
    console.warn('AI 教案生成失败，使用本地短课模板:', error);
  }
  plan ||= createFallbackLessonPlan({ ...provisionalBrief, focus: plannedFocus });
  try {
    const lessonId = await invoke('save_lesson_plan', {
      subjectId,
      title: plan.title,
      knowledgePointIdsJson: JSON.stringify(orderedPoints.slice(0, 3).map(point => point.id)),
      lessonJson: JSON.stringify(plan),
    });
    return {
      plan,
      currentLesson: { id: lessonId, title: plan.title, lesson_json: JSON.stringify(plan), status: 'current' },
      created: true,
    };
  } catch (error) {
    console.warn('保存课时教案失败:', error);
  }
  return {
    plan,
    currentLesson: { title: plan.title, lesson_json: JSON.stringify(plan), status: 'current' },
    created: true,
  };
}

// ============ 作业列表 ============
async function renderHomeworkList(container) {
  const subjectId = state.currentSubject;
  if (!subjectId) return renderSidebarEmptyState(container, ICONS.homework, '选择一个科目', '作业按当前科目整理。');
  try {
    const items = await invoke('get_homework', { subjectId });
    if (!items.length) return renderSidebarEmptyState(container, ICONS.homework, '还没有作业', '创建练习或等待老师布置作业。');
    items.forEach(homework => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-item';
      item.innerHTML = `<span class="li-avatar" aria-hidden="true">${ICONS.homework}</span><div class="li-text"><div class="li-name">${escapeHtml(homework.title)}</div><div class="li-sub">${homework.status === 'completed' ? '已提交' : homework.status === 'graded' ? '已批改' : '待完成'}</div></div>`;
      item.addEventListener('click', () => openTab(`homework-${subjectId}`, '我的作业', 'homework'));
      container.appendChild(item);
    });
    if ($('#sidebarCount')) $('#sidebarCount').textContent = String(items.length);
  } catch (error) {
    renderSidebarEmptyState(container, ICONS.warning, '作业加载失败', String(error));
  }
}

// ============ 复习列表 ============
async function renderReviewList(container) {
  const subjectId = state.currentSubject;
  if (!subjectId) return renderSidebarEmptyState(container, ICONS.review, '选择一个科目', '复习内容按当前科目安排。');
  try {
    const [mistakes, points] = await Promise.all([
      invoke('get_mistakes', { subjectId }).catch(() => []),
      invoke('get_knowledge_points', { subjectId }).catch(() => []),
    ]);
    const queue = buildReviewQueue(points, mistakes);
    const total = queue.length + mistakes.length;
    if (!total) return renderSidebarEmptyState(container, ICONS.review, '还没有复习内容', '完成真实练习后，错题和知识点会进入这里。');
    queue.slice(0, 6).forEach(point => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-item';
      item.innerHTML = `<span class="li-avatar" aria-hidden="true">${ICONS.review}</span><div class="li-text"><div class="li-name">${escapeHtml(point.name)}</div><div class="li-sub">${point.label} · 掌握度 ${Math.round(point.mastery * 100)}%</div></div>`;
      item.addEventListener('click', () => openTab(`review-${subjectId}`, '复习计划', 'review'));
      container.appendChild(item);
    });
    if ($('#sidebarCount')) $('#sidebarCount').textContent = String(total);
  } catch (error) {
    renderSidebarEmptyState(container, ICONS.warning, '复习内容加载失败', String(error));
  }
}

function renderSidebarEmptyState(container, icon, title, description) {
  container.innerHTML = `
    <div class="sidebar-empty" role="status">
      <span class="sidebar-empty-icon" aria-hidden="true">${icon}</span>
      <strong>${title}</strong>
      <p>${description}</p>
    </div>
  `;
}

// ============ 设置列表 ============
function renderSettingsList(container) {
  [
    { id: 'set1', title: '模型设置', desc: '配置 AI 老师', icon: ICONS.cpu },
    { id: 'set2', title: '界面设置', desc: '主题、字体', icon: ICONS.palette },
    { id: 'set3', title: '数据管理', desc: '备份与恢复', icon: ICONS.database },
    { id: 'set4', title: '关于', desc: '版本 0.1.0', icon: ICONS.info },
  ].forEach(section => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'list-item';
    item.setAttribute('aria-label', `打开${section.title}`);
    item.innerHTML = `
      <span class="li-avatar" aria-hidden="true">${section.icon}</span>
      <div class="li-text">
        <div class="li-name">${section.title}</div>
        <div class="li-sub">${section.desc}</div>
      </div>
    `;
    item.addEventListener('click', () => openTab(`setting-${section.id}`, section.title, 'settings'));
    container.appendChild(item);
  });
}

// ============ 标签页管理 ============
function openTab(tabId, title, type) {
  let tab = state.tabs.find(t => t.id === tabId);
  if (!tab) {
    tab = { id: tabId, title, type };
    state.tabs.push(tab);
  }
  state.activeTab = tabId;
  renderTabs();
  renderTabContent(tab);
}

function closeTab(tabId) {
  teacherVoice.stop();
  state.tabs = state.tabs.filter(t => t.id !== tabId);
  if (state.activeTab === tabId) {
    state.activeTab = state.tabs.length > 0 ? state.tabs[state.tabs.length - 1].id : null;
  }
  renderTabs();
  if (state.activeTab) renderTabContent(state.tabs.find(t => t.id === state.activeTab));
  else renderEmptyWorkspace();
}

function renderTabs() {
  const tabbar = $('#tabbar');
  tabbar.innerHTML = '';
  if (!state.tabs.length) {
    tabbar.innerHTML = `
      <div class="tab active welcome-tab" role="tab" aria-selected="true" tabindex="0">
        <span class="tab-dot" aria-hidden="true"></span>
        <span class="tab-title">欢迎</span>
      </div>
    `;
    return;
  }
  state.tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    const active = tab.id === state.activeTab;
    tabEl.className = `tab ${active ? 'active' : ''}`;
    tabEl.dataset.tabId = tab.id;
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', String(active));
    tabEl.tabIndex = active ? 0 : -1;
    tabEl.innerHTML = `
      <span class="tab-dot" aria-hidden="true"></span>
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <button class="tab-close" type="button" title="关闭" aria-label="关闭${tab.title}">${ICONS.close}</button>
    `;
    const activate = () => {
      state.activeTab = tab.id;
      renderTabs();
      renderTabContent(tab);
    };
    tabEl.addEventListener('click', (event) => {
      if (!event.target.closest('.tab-close')) activate();
    });
    tabEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    tabbar.appendChild(tabEl);
  });
}

function renderTabContent(tab) {
  const view = $('#view');
  releaseStudentVoiceTurn();
  submitCodeExerciseToTeacher = null;
  commitQuizEvidence = null;
  practicePanel.close({ preservePending: true });
  quizPanel.close({ preservePending: true });
  view.innerHTML = '';
  const typeLabels = { assess: '摸底', chat: '课堂', note: '笔记', homework: '作业', review: '复习', settings: '设置' };
  if ($('#editorBreadcrumb')) {
    $('#editorBreadcrumb').innerHTML = `<span>${typeLabels[tab.type] || '工作区'}</span><span class="breadcrumb-separator">/</span><span>${tab.title}</span>`;
  }
  if ($('#statusLesson')) $('#statusLesson').textContent = typeLabels[tab.type] || '工作区';
  switch (tab.type) {
    case 'assess':   renderAssessView(view, tab.id.replace('assess-', '')); break;
    case 'chat':     renderChatView(view, tab.id.replace('chat-', '')); break;
    case 'note':     renderNoteView(view); break;
    case 'homework': renderHomeworkView(view); break;
    case 'review':   renderReviewView(view); break;
    case 'settings': renderSettingsView(view, tab.id); break;
    case 'code-file': /* 由 openFileInEditor 直接渲染 */ break;
    default:         renderPlaceholderView(view, tab.title);
  }
}

// ============ 核心：摸底视图 ============
function renderAssessView(container, subjectId) {
  const subject = state.subjects.find(s => s.id === subjectId);
  const subjectName = subject ? subject.name : '学习';

  container.innerHTML = `
    <div class="assess-phase" id="assessPhase">
      <div class="assess-header">
        <div class="assess-heading">
          <div class="assess-icon" aria-hidden="true">${getSubjectIcon(subjectId)}</div>
          <span><h2>${escapeHtml(subjectName)}入学摸底</h2><p class="assess-subtitle">不是考试，老师会根据你的真实基础调整课程</p></span>
        </div>
        <ol class="assess-steps" aria-label="摸底流程">
          <li class="active"><span>1</span>聊基础</li>
          <li><span>2</span>做小测</li>
          <li><span>3</span>生成计划</li>
        </ol>
      </div>
      <div class="assessment-objective-bar" id="assessmentObjective" role="status">
        <span>当前访谈任务</span><strong>正在读取摸底进度…</strong><small>老师会依据你的回答决定下一步</small>
      </div>
      <div class="messages" id="assessMessages"></div>
      <div class="composer-shell">
        <div class="quick-replies assess-quick-replies" id="assessQuickReplies" aria-label="快速回答">
          <button type="button" data-reply="我完全没学过，想从基础开始。">完全没学过</button>
          <button type="button" data-reply="以前学过一点，但很多内容记不清了。">学过但忘了</button>
          <button type="button" data-reply="我有一些基础，可以直接问我几个问题。">有一些基础</button>
        </div>
        <div class="composer-meta"><span id="assessHint">如实回答即可，这里不计分</span><span>Enter 发送 · Shift+Enter 换行</span></div>
        <div class="composer">
          <textarea id="assessInput" placeholder="回答老师的问题…" rows="1" aria-label="回答老师的问题"></textarea>
          <button id="assessSend" type="button" title="发送" aria-label="发送回答">${ICONS.send}</button>
          <button id="assessToTest" type="button" class="btn-primary" style="display:none; margin-left: 8px; padding: 0 16px; font-size: 13px;">开始测试</button>
        </div>
      </div>
    </div>
  `;

  initAssessment(subjectId);
}

async function initAssessment(subjectId) {
  const messagesEl = document.getElementById('assessMessages');
  const inputEl = document.getElementById('assessInput');
  const sendBtn = document.getElementById('assessSend');
  const toTestBtn = document.getElementById('assessToTest');
  const quickRepliesEl = document.getElementById('assessQuickReplies');
  const assessHintEl = document.getElementById('assessHint');
  const assessmentObjectiveEl = document.getElementById('assessmentObjective');
  let assessmentGenerating = false;

  const subject = state.subjects.find(s => s.id === subjectId);
  const subjectName = subject ? subject.name : '学习';
  const subjectIsAmbiguous = /^[\d\s._-]+$/.test(subjectName);

  // 摸底阶段的状态
  const assessState = {
    phase: 'chat',        // chat | testing | result
    chatHistory: [],      // 聊天记录
    chatSummary: '',      // 聊天摘要（发给 AI 出题用）
    questions: [],        // 测试题
    answers: [],          // 学生答案
    currentQ: 0,          // 当前题号
    results: null,        // 测试结果
    teacherTurns: [],     // 教师动作与访谈证据
    pendingQuickReplies: [], // 当前未回答摸底题的选项
    interviewStage: 0,    // 只在证据充分时推进
    evidenceTags: [],     // 客户端从学生原话提取的保守证据标签
  };

  // 聊天阶段的 system prompt
  assessState.chatHistory.push({
    role: 'system',
    content: `你是一位耐心、专业的${subjectName}老师，正在了解一个新学生的基础。
你的任务是通过聊天快速判断学生的水平。问3-5个问题，从简单到稍难：
1. 先问有没有学过${subjectName}
2. 再问一些基础概念
3. 最后问一个稍微进阶的问题

规则：
- 一次只问一个问题
- 问题不超过 70 个汉字，只出现一个问号
- 优先给 A/B/C 选项、改错或一行作答，让学生一眼知道怎么回答
- 不要要求学生同时说明工具、场景和内容，不要让学生列举学过的术语
- 学生说“基础语法”“学过一点”等概括时，直接给一个微型任务验证，不再追问术语清单
- 语气自然、尊重，不要像考试，也不要使用 emoji、卖萌或网络化口吻
- 表扬必须说明学生具体做对了什么，不使用空泛鼓励
- 如果科目名称含义不明确，先问学生具体想学什么、希望达到什么目标，不要猜测名称的含义
- 根据回答判断水平（零基础/入门/有一点基础/中级）
- 只有完成至少一道代表性任务和一道迁移检查后，才可以邀请学生进入正式小测

这里可以给一分钟内完成的微型能力任务，但不要生成正式题集；正式小测由系统另外生成。`,
  });

  try {
    const savedSessionJson = await invoke('get_teaching_session', { subjectId });
    const savedSession = savedSessionJson ? JSON.parse(savedSessionJson) : null;
    if (savedSession) state.teachingSessions[subjectId] = savedSession;
    if (savedSession?.assessment && savedSession.assessment.phase !== 'result') {
      Object.assign(assessState, savedSession.assessment);
    }
  } catch (error) {
    console.warn('恢复摸底进度失败:', error);
  }
  if (!Array.isArray(assessState.teacherTurns)) assessState.teacherTurns = [];
  if (!Array.isArray(assessState.evidenceTags)
    || (!assessState.evidenceTags.length && assessState.chatHistory.some(message => message?.role === 'user'))) {
    const rebuilt = rebuildAssessmentProgress(assessState.chatHistory, subjectIsAmbiguous);
    assessState.interviewStage = rebuilt.completedTurns;
    assessState.evidenceTags = rebuilt.evidenceTags;
  }
  if (!Number.isInteger(assessState.interviewStage)) assessState.interviewStage = 0;

  function updateAssessmentObjective() {
    const stage = getAssessmentInterviewStage(assessState.interviewStage, subjectIsAmbiguous);
    if (assessmentObjectiveEl) {
      assessmentObjectiveEl.innerHTML = `<span>当前访谈任务</span><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.objective)}</small>`;
    }
    return stage;
  }
  updateAssessmentObjective();

  function makeRow(who) {
    const roleClass = who === 'me' ? 'user' : 'bot';
    const previousRow = messagesEl.lastElementChild;
    const previousBubble = previousRow?.classList.contains(roleClass)
      ? previousRow.querySelector(`.msg.${roleClass}`)
      : null;
    if (previousBubble) {
      const segment = document.createElement('div');
      segment.className = 'message-content message-segment';
      previousBubble.appendChild(segment);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return segment;
    }
    const row = document.createElement('div');
    row.className = `row ${roleClass}`;
    const av = document.createElement('div');
    av.className = `mini-avatar ${who === 'me' ? 'student' : 'teacher'}`;
    av.innerHTML = who === 'me' ? AVATAR.me : AVATAR.teacher;
    const bubble = document.createElement('div');
    bubble.className = `msg ${who === 'me' ? 'user' : 'bot'}`;
    row.appendChild(av);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (who === 'teacher') {
      const header = document.createElement('div');
      header.className = 'message-header';
      const label = document.createElement('div');
      label.className = 'message-author';
      label.textContent = `${subjectName}老师 · 入学摸底`;
      const content = document.createElement('div');
      content.className = 'message-content message-segment';
      header.append(label, createTeacherVoiceButton());
      bubble.append(header, content);
      return content;
    }
    const content = document.createElement('div');
    content.className = 'message-content message-segment';
    bubble.appendChild(content);
    return content;
  }

  // 老师打招呼
  function greet() {
    const b = makeRow('teacher');
    b.textContent = subjectIsAmbiguous
      ? '你好，我是你的课程老师。正式开始前，我先了解一下：你希望在这个科目里学习什么，最后想达到怎样的目标？'
      : `你好，我是你的${subjectName}老师。在正式开始之前，我想先了解一下你的基础。你之前有学过${subjectName}吗？`;
    bindTeacherVoiceControl(b, b.textContent, { autoSpeak: true });
    assessState.chatHistory.push({ role: 'assistant', content: b.textContent });
  }

  async function sendChat(overrideText = '', { reuseStudent = false } = {}) {
    const text = String(overrideText || inputEl.value).trim();
    if (!text || sendBtn.disabled) return;
    releaseStudentVoiceTurn();

    let routed = { responseProfile: null, completedTurns: assessState.interviewStage, evidenceTags: [] };
    if (!reuseStudent) {
      makeRow('me').textContent = text;
      assessState.pendingQuickReplies = [];
      assessState.chatHistory.push({ role: 'user', content: text });
      routed = routeAssessmentInterview({
        completedTurns: assessState.interviewStage,
        subjectIsAmbiguous,
        studentResponse: text,
      });
      assessState.interviewStage = routed.completedTurns;
      assessState.evidenceTags = [...new Set([
        ...assessState.evidenceTags,
        ...routed.evidenceTags,
      ])];
    }
    updateAssessmentObjective();
    const turnPrompt = buildAssessmentTurnPrompt({
      subjectName,
      completedTurns: assessState.interviewStage,
      subjectIsAmbiguous,
      responseProfile: routed.responseProfile,
    });
    const requestMessages = [
      assessState.chatHistory[0],
      { role: 'system', content: turnPrompt },
      ...assessState.chatHistory.slice(1),
    ];
    inputEl.value = '';
    sendBtn.disabled = true;
    inputEl.disabled = true;
    quickRepliesEl?.classList.add('is-hidden');
    if (assessHintEl) assessHintEl.textContent = '老师正在判断你的基础…';

    const botEl = makeRow('teacher');
    botEl.innerHTML = `<span class="request-state"><span class="typing" aria-hidden="true"><span></span><span></span><span></span></span><span class="request-state-text">正在理解你的回答</span></span>`;
    let botText = '';
    let streamDone = false;
    const requestStatus = botEl.querySelector('.request-state-text');
    const statusTimers = [
      setTimeout(() => { if (requestStatus) requestStatus.textContent = '正在选择下一个摸底问题'; }, 5000),
      setTimeout(() => { if (requestStatus) requestStatus.textContent = '模型响应较慢，仍在等待'; }, 15000),
    ];

    try {
      // 先注册监听器，再发起请求
      const requestId = crypto.randomUUID();
      const unlisten = await listen('chat-stream', (event) => {
        const payload = event.payload;
        if (payload.requestId !== requestId) return;
        if (payload.type === 'content') {
          botText += payload.text;
          if (requestStatus) requestStatus.textContent = '老师正在组织下一个摸底任务';
        } else if (payload.type === 'done') {
          streamDone = true;
          unlisten();
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });

      await invoke('send_chat_stream', {
        baseUrl: APP_CONFIG.base_url,
        apiKey: APP_CONFIG.api_key,
        model: APP_CONFIG.models.chat,
        messagesJson: JSON.stringify(requestMessages),
        requestId,
      });

      if (botText) {
        const parsed = parseAIResponse(botText);
        if (parsed.unsafe) throw new Error('老师回复格式不完整，请重新发送');
        const { message, structured } = parsed;
        const teacherMove = normalizeTeacherMove(structured, 'diagnose');
        renderRichMessage(botEl, message || '请继续说说你的想法。');
        bindTeacherVoiceControl(botEl, message || '请继续说说你的想法。', { autoSpeak: true });
        if (teacherMove) {
          renderTeacherMoveFooter(botEl.parentElement, teacherMove);
          assessState.teacherTurns.push(teacherMove);
        }
        const nextReplies = normalizeQuickReplies(structured?.quick_replies);
        assessState.pendingQuickReplies = nextReplies;
        renderQuickReplyButtons(quickRepliesEl, []);
        renderInlineQuickReplies(botEl, nextReplies, reply => void sendChat(reply));
        assessState.chatHistory.push({ role: 'assistant', content: message || botText, quickReplies: nextReplies });
        const nextStage = updateAssessmentObjective();
        await persistTeachingSession(subjectId, { assessment: assessState });
        if (nextStage.readyForTest) await startTest();
      } else {
        throw new Error('模型没有返回可显示的内容');
      }
    } catch (e) {
      const reason = typeof e === 'string' ? e : (e?.message || '未知错误');
      const errorRow = botEl.closest('.row');
      if (errorRow) {
        errorRow.className = 'assessment-request-error';
        errorRow.innerHTML = `<span class="response-error"><strong>老师暂时没有收到请求</strong><span>${escapeHtml(reason)}</span><button type="button" class="retry-response">重试本次回答</button></span>`;
        errorRow.querySelector('.retry-response')?.addEventListener('click', () => {
          errorRow.remove();
          void sendChat(text, { reuseStudent: true });
        });
      }
    } finally {
      statusTimers.forEach(clearTimeout);
      if (assessState.phase === 'chat' && !assessmentGenerating) {
        sendBtn.disabled = false;
        inputEl.disabled = false;
        if (assessHintEl) assessHintEl.textContent = '如实回答即可，这里不计分';
        inputEl.focus();
      }
    }
  }

  quickRepliesEl?.addEventListener('click', event => {
    const button = event.target.closest('[data-reply]');
    if (!button) return;
    void sendChat(button.dataset.reply || '');
  });
  // 进入测试阶段
  async function startTest() {
    if (assessmentGenerating || assessState.phase !== 'chat') return;
    assessmentGenerating = true;
    toTestBtn.style.display = 'none';
    sendBtn.style.display = 'none';
    inputEl.placeholder = '正在出题中...';
    inputEl.disabled = true;

    // 聊天摘要
    const summary = assessState.chatHistory
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? '学生' : '老师'}：${m.content}`)
      .join('\n');

    // 添加一个提示
    const tipEl = document.createElement('div');
    tipEl.className = 'reasoning assessment-generation-state';
    tipEl.innerHTML = `<div class="label">${ICONS.clipboard} 正在生成摸底测试题...</div><div class="loading-dots"><span></span><span></span><span></span></div>`;
    messagesEl.appendChild(tipEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    inputEl.disabled = true;

    try {
      const resultStr = await invoke('generate_assessment', {
        baseUrl: APP_CONFIG.base_url,
        apiKey: APP_CONFIG.api_key,
        model: APP_CONFIG.models.chat,
        subject: subjectName,
        chatSummary: summary,
      });

      const result = JSON.parse(resultStr);
      const validation = validateAssessmentPayload(result);
      if (!validation.valid) throw new Error(validation.error);
      assessState.questions = result.questions;
      assessState.phase = 'testing';
      assessmentGenerating = false;
      assessState.currentQ = 0;
      await persistTeachingSession(subjectId, { assessment: assessState });

      tipEl.remove();
      renderTestQuestion(messagesEl, assessState, subjectId, inputEl, sendBtn);

    } catch (e) {
      assessmentGenerating = false;
      tipEl.innerHTML = `<div class="label">${ICONS.warning} 出题失败</div><div>${escapeHtml(e.toString())}</div><button class="btn-secondary assessment-retry-generate" type="button">重新生成测验</button>`;
      tipEl.querySelector('.assessment-retry-generate')?.addEventListener('click', () => {
        tipEl.remove();
        void startTest();
      });
      inputEl.disabled = false;
      sendBtn.style.display = '';
    }
  }

  // 渲染测试题
  function renderTestQuestion(messagesEl, assessState, subjectId, inputEl, sendBtn) {
    const q = assessState.questions[assessState.currentQ];
    if (!q) {
      finishAssessment(messagesEl, assessState, subjectId);
      return;
    }

    const qEl = document.createElement('div');
    qEl.className = 'assess-question';
    let optionsHTML = '';

    if (q.type === 'choice') {
      optionsHTML = (q.options || []).map((opt, i) =>
        `<button class="assess-option" data-idx="${i}">${escapeHtml(opt)}</button>`
      ).join('');
    } else {
      optionsHTML = `<div class="assess-fill-wrap">
        <input type="text" class="assess-fill-input" placeholder="输入你的答案..." />
        <button class="assess-fill-btn btn-primary">确认</button>
      </div>`;
    }

    qEl.innerHTML = `
      <div class="assess-q-header">
        <span class="assess-q-num">第 ${assessState.currentQ + 1} / ${assessState.questions.length} 题</span>
        <span class="assess-q-diff">难度 ${Math.min(5, Math.max(1, q.difficulty || 1))} / 5</span>
      </div>
      <div class="assess-q-text"></div>
      <div class="assess-q-options">${optionsHTML}</div>
      <div class="assess-q-feedback" style="display:none"></div>
    `;

    renderQuestionContent(qEl.querySelector('.assess-q-text'), q.question);
    messagesEl.appendChild(qEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // 隐藏输入框
    inputEl.parentElement.style.display = 'none';

    // 绑定选项点击
    if (q.type === 'choice') {
      qEl.querySelectorAll('.assess-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          const correct = idx === q.answer;
          assessState.answers.push({ questionId: q.id, answer: idx, correct, knowledgePoint: q.knowledge_point });
          void showFeedback(qEl, correct, q, idx);
        });
      });
    } else {
      const fillBtn = qEl.querySelector('.assess-fill-btn');
      const fillInput = qEl.querySelector('.assess-fill-input');
      fillBtn.addEventListener('click', () => {
        const ans = fillInput.value.trim();
        if (!ans) return;
        const correct = ans.toLowerCase() === String(q.answer).toLowerCase();
        assessState.answers.push({ questionId: q.id, answer: ans, correct, knowledgePoint: q.knowledge_point });
        void showFeedback(qEl, correct, q, ans);
      });
      fillInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fillBtn.click();
      });
    }

    async function showFeedback(qEl, correct, q, studentAnswer) {
      const fb = qEl.querySelector('.assess-q-feedback');
      fb.style.display = 'block';
      // 禁用所有选项
      qEl.querySelectorAll('.assess-option').forEach(b => b.disabled = true);
      const fillInput = qEl.querySelector('.assess-fill-input');
      if (fillInput) fillInput.disabled = true;

      if (correct) {
        fb.innerHTML = `<div class="fb-correct">${ICONS.check}<span><strong>回答正确</strong><small>你已经通过这个知识点检查。</small></span></div>`;
      } else {
        const correctAns = q.type === 'choice' ? (q.options || [q.answer])[q.answer] : q.answer;
        fb.innerHTML = `<div class="fb-wrong">${ICONS.xMark}<span><strong>这一步还不稳定</strong><small>正确答案：${escapeHtml(correctAns)}。先比较差异，再继续下一题。</small></span></div>`;
        if (q.type === 'choice') {
          qEl.querySelector(`.assess-option[data-idx="${studentAnswer}"]`)?.classList.add('is-wrong');
          qEl.querySelector(`.assess-option[data-idx="${q.answer}"]`)?.classList.add('is-correct');
        }
        invoke('save_mistake', {
          subjectId,
          knowledgePoint: q.knowledge_point || '',
          question: q.question || '',
          studentAnswer: q.type === 'choice' ? String((q.options || [])[Number(studentAnswer)] ?? studentAnswer) : String(studentAnswer),
          correctAnswer: String(correctAns),
          errorType: 'assessment_gap',
        }).catch(() => {});
      }
      await logLearningEvent(subjectId, 'assessment_answer', [q.knowledge_point || ''], { correct, type: q.type });
      void persistTeachingSession(subjectId, { assessment: assessState });
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn-primary assess-next-question';
      next.textContent = '继续下一题';
      next.addEventListener('click', () => {
        next.disabled = true;
        assessState.currentQ++;
        void persistTeachingSession(subjectId, { assessment: assessState });
        renderTestQuestion(messagesEl, assessState, subjectId, inputEl, sendBtn);
      });
      fb.appendChild(next);
    }
  }

  // 测试完成，展示结果
  async function finishAssessment(messagesEl, assessState, subjectId) {
    assessState.phase = 'result';
    await persistTeachingSession(subjectId, { assessment: assessState });
    const subject = state.subjects.find(item => item.id === subjectId);
    if (!subject) throw new Error('找不到当前摸底科目');
    const total = assessState.answers.length;
    const correct = assessState.answers.filter(a => a.correct).length;
    const score = total > 0 ? Math.round(correct / total * 100) : 0;

    // 按知识点分组
    const byPoint = {};
    assessState.answers.forEach(a => {
      if (!byPoint[a.knowledgePoint]) byPoint[a.knowledgePoint] = { total: 0, correct: 0 };
      byPoint[a.knowledgePoint].total++;
      if (a.correct) byPoint[a.knowledgePoint].correct++;
    });

    const resultEl = document.createElement('div');
    resultEl.className = 'assess-result';
    let pointsHTML = Object.entries(byPoint).map(([name, stats]) => {
      const mastery = stats.correct / stats.total;
      const bar = Math.round(mastery * 100);
      const color = mastery >= 0.7 ? 'var(--success)' : mastery >= 0.4 ? 'var(--primary)' : 'var(--accent)';
      return `<div class="result-point">
        <div class="rp-name">${name}</div>
        <div class="rp-bar"><div class="rp-fill" style="width:${bar}%; background:${color}"></div></div>
        <div class="rp-score">${stats.correct}/${stats.total}</div>
      </div>`;
    }).join('');

    resultEl.innerHTML = `
      <div class="result-header">
        <h2>${ICONS.barChart} 摸底结果</h2>
        <div class="result-score">${score}分</div>
        <p>答对 ${correct} / ${total} 题</p>
      </div>
      <div class="result-points">${pointsHTML}</div>
      <div class="result-actions">
        <button class="btn-primary" type="button" id="startLearning">开始学习</button>
      </div>
    `;
    messagesEl.appendChild(resultEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // 存储知识点到数据库
    for (const [name, stats] of Object.entries(byPoint)) {
      const mastery = stats.correct / stats.total;
      try {
        // 先插入知识点
        await invoke('add_knowledge_point', {
          subjectId, name, description: '', mastery,
        });
      } catch (e) {
        console.warn('存储知识点失败:', e);
      }
    }

    // 标记已摸底
    try {
      await invoke('mark_assessed', { subjectId });
      subject.assessed = true;
    } catch (e) {
      console.warn('标记摸底失败:', e);
    }

    // "开始学习"按钮
    resultEl.querySelector('#startLearning').addEventListener('click', () => {
      void persistTeachingSession(subjectId, { assessment: null, pendingAction: null });
      if (!promoteAssessmentTab(state, subjectId)) return;
      renderTabs();
      const chatTab = state.tabs.find(tab => tab.id === `chat-${subjectId}`);
      if (chatTab) renderTabContent(chatTab);
      updateRightPanel(subject);
    });
  }

  sendBtn.addEventListener('click', () => void sendChat());
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  toTestBtn.addEventListener('click', startTest);

  if (assessState.chatHistory.length <= 1) {
    greet();
    await persistTeachingSession(subjectId, { assessment: assessState });
  } else {
    const visibleHistory = assessState.chatHistory.slice(1);
    const assistantCount = visibleHistory.filter(message => message.role === 'assistant').length;
    const generatedCount = Math.max(0, assistantCount - 1);
    const metadataOffset = Math.max(0, generatedCount - assessState.teacherTurns.length);
    let assistantIndex = -1;
    for (const [messageIndex, message] of visibleHistory.entries()) {
      const content = makeRow(message.role === 'user' ? 'me' : 'teacher');
      if (message.role === 'assistant') {
        renderRichMessage(content, message.content);
        bindTeacherVoiceControl(content, message.content);
        if (messageIndex === visibleHistory.length - 1) {
          const replies = normalizeQuickReplies(message.quickReplies || assessState.pendingQuickReplies);
          const restoredReplies = replies.length ? replies : extractChoiceRepliesFromText(message.content);
          assessState.pendingQuickReplies = restoredReplies;
          renderQuickReplyButtons(quickRepliesEl, []);
          renderInlineQuickReplies(content, restoredReplies, reply => void sendChat(reply));
        }
      }
      else content.textContent = message.content;
      if (message.role === 'assistant') {
        assistantIndex += 1;
        const generatedIndex = assistantIndex - 1;
        const metadataIndex = generatedIndex - metadataOffset;
        if (generatedIndex >= 0 && metadataIndex >= 0) renderTeacherMoveFooter(content.parentElement, assessState.teacherTurns[metadataIndex]);
      }
    }
  }
  if (assessState.phase === 'testing' && assessState.questions.length) {
    renderTestQuestion(messagesEl, assessState, subjectId, inputEl, sendBtn);
  } else if (assessState.phase === 'chat' && assessState.chatHistory.length >= 7) {
    const restoredStage = updateAssessmentObjective();
    if (restoredStage.readyForTest) queueMicrotask(() => void startTest());
    else toTestBtn.style.display = 'inline-flex';
  }
  inputEl.focus();
}
function renderChatView(container, subjectId) {
  const subject = state.subjects.find(s => s.id === subjectId);
  const subjectName = subject ? subject.name : '学习';

  container.innerHTML = `
    <section class="teacher-desk" aria-label="本节课教学安排">
      <div class="teacher-desk-identity">
        <span class="teacher-desk-avatar" aria-hidden="true">${AVATAR.teacher}</span>
        <span><strong>${escapeHtml(subjectName)}老师</strong><small id="teacherPhase">准备课堂</small></span>
      </div>
      <div class="teacher-desk-plan">
        <span class="teacher-desk-label">本节目标</span>
        <span id="teacherGoal">正在读取学习档案…</span>
      </div>
      <div class="teacher-desk-next">
        <span class="teacher-desk-label">下一步</span>
        <span id="teacherNext">根据你的学习情况安排</span>
      </div>
      <div class="teacher-desk-actions">
        ${/java/iu.test(subjectName) ? `<button id="openProgrammingLab" type="button" title="打开 Java 动手实验" aria-label="打开 Java 动手实验">${ICONS.code}</button>` : ''}
        <button id="lessonSummary" type="button" title="生成课堂小结" aria-label="生成课堂小结">${ICONS.barChart}</button>
        <button id="lessonAssessment" type="button" title="开始章节评估" aria-label="开始章节评估">${ICONS.clipboard}</button>
      </div>
      <ol class="lesson-rhythm" aria-label="本节课进度">
        <li class="lesson-rhythm-step active" data-phase="orient"><span>1</span>定位</li>
        <li class="lesson-rhythm-step" data-phase="explain"><span>2</span>讲解</li>
        <li class="lesson-rhythm-step" data-phase="practice"><span>3</span>练习</li>
        <li class="lesson-rhythm-step" data-phase="check"><span>4</span>检查</li>
      </ol>
    </section>
    <section class="resume-strip" id="resumeStrip" aria-label="续学建议" hidden>
      <div>${ICONS.review}<span><strong id="resumeTitle">继续上次学习</strong><small id="resumeDetail"></small></span></div>
      <span class="resume-strip-actions">
        <button class="btn-secondary" id="resumeReview" type="button">先复习一道</button>
        <button class="btn-primary" id="resumeContinue" type="button">继续本节</button>
      </span>
    </section>
    <section class="classroom-board" id="classroomBoard" aria-labelledby="classroomBoardTitle" hidden>
      <header class="classroom-board-header">
        <span class="classroom-board-icon" aria-hidden="true">${ICONS.book}</span>
        <span><small>课堂板书</small><strong id="classroomBoardTitle">当前要点</strong></span>
      </header>
      <div class="classroom-board-items" id="classroomBoardItems"></div>
    </section>
    <div class="classroom-learning-area" id="classroomLearningArea">
      <div class="classroom-conversation">
        <div class="messages" id="messages"></div>
        <div class="composer-shell">
      <div class="teacher-nudge" id="teacherNudge" role="status" hidden>
        <span>${ICONS.lightbulb}<strong>还在想刚才那一步吗？</strong></span>
        <button type="button" data-nudge="continue">继续练习</button>
        <button type="button" data-nudge="pause">我还在思考</button>
      </div>
      <section class="task-workspace" id="taskWorkspace" aria-labelledby="taskPrompt" hidden>
        <div class="task-resize-handle" id="taskResizeHandle" role="separator" aria-label="调整代码编辑器高度" aria-orientation="horizontal" tabindex="0"></div>
        <header class="task-workspace-header">
          <span class="task-workspace-icon" aria-hidden="true">${ICONS.clipboard}</span>
          <span><small id="taskLabel">当前任务</small><strong id="taskKnowledgePoint">课堂检查</strong></span>
          <label class="task-observer-switch" id="taskObserverControl" title="暂停或恢复老师对当前过程草稿的临时观察" hidden>
            <input id="taskObserverToggle" type="checkbox" checked>
            <span class="task-observer-track" aria-hidden="true"><span></span></span>
            <span>${ICONS.eye}<span>老师看草稿</span></span>
          </label>
          <span class="task-expected" id="taskExpected">一个短答案</span>
          <button class="task-panel-toggle" id="taskPanelToggle" type="button" aria-label="展开练习编辑器" title="展开练习编辑器" aria-expanded="false">${ICONS.chevronRight}</button>
        </header>
        <p class="task-prompt" id="taskPrompt"></p>
        <p class="task-original" id="taskOriginal" hidden></p>
        <div class="quick-replies" id="quickReplies" aria-label="当前任务快速回答"></div>
        <div class="task-answer-editor">
          <div class="task-answer-main">
            <label class="sr-only" for="taskAnswer">填写当前任务答案</label>
            <textarea id="taskAnswer" rows="2" placeholder="在这里直接作答…" aria-describedby="taskExpected taskStatus"></textarea>
            <div class="task-code-editor" id="taskCodeEditor" aria-label="代码作答编辑器" hidden></div>
            <div class="draft-coach" id="draftCoach" role="status" aria-live="polite" hidden>
              <span class="draft-coach-icon" aria-hidden="true">${ICONS.eye}</span>
              <span class="draft-coach-copy"><strong id="draftCoachTitle">老师看到这一步</strong><span id="draftCoachMessage"></span></span>
              <button id="draftCoachDismiss" type="button" title="收起草稿反馈" aria-label="收起草稿反馈">${ICONS.close}</button>
            </div>
          </div>
          <div class="task-answer-actions">
            <button class="btn-secondary task-support-action" id="taskHint" type="button">${ICONS.lightbulb}<span>给我提示</span></button>
            <button class="btn-secondary task-support-action" id="taskAlternate" type="button">${ICONS.book}<span>换种讲法</span></button>
            <button class="btn-primary" id="taskSubmit" type="button">${ICONS.send}<span>提交作答</span></button>
          </div>
        </div>
        <div class="task-status" id="taskStatus" role="status" aria-live="polite"></div>
      </section>
      <div class="composer-meta"><span id="composerHint" role="status" aria-live="polite">自由提问或补充说明</span><span>Enter 发送 · Shift+Enter 换行</span></div>
      <div class="composer">
        <textarea id="input" placeholder="向老师提问，或补充你的思路…" rows="1" aria-label="向${escapeHtml(subjectName)}老师自由提问或补充"></textarea>
        <button id="send" type="button" title="发送" aria-label="发送问题">${ICONS.send}</button>
      </div>
        </div>
      </div>
      <div class="programming-lab-resizer" id="programmingLabResizer" role="separator" aria-label="调整编程实验区宽度" aria-orientation="vertical" tabindex="0" hidden></div>
      <aside class="programming-lab" id="programmingLab" aria-labelledby="programmingLabTitle" hidden>
        <header class="programming-lab-header">
          <span>${ICONS.code}<span><small>动手实验</small><strong id="programmingLabTitle">Java 实验</strong></span></span>
          <span class="programming-lab-actions">
            <button id="programmingLabReset" type="button" title="恢复初始代码" aria-label="恢复初始代码">${ICONS.review}</button>
            <button id="programmingLabClose" type="button" title="收起实验区" aria-label="收起实验区">${ICONS.close}</button>
          </span>
        </header>
        <div class="programming-lab-goal"><strong id="programmingLabGoal"></strong><ul id="programmingLabObservations"></ul></div>
        <div class="programming-lab-tabs"><button type="button" class="active">Main.java</button><span id="programmingLabRuntime">检测 JDK…</span></div>
        <div class="programming-lab-editor" id="programmingLabEditor"></div>
        <div class="programming-lab-toolbar">
          <button class="btn-primary" id="programmingLabRun" type="button">${ICONS.run}<span>运行</span></button>
          <button class="btn-secondary" id="programmingLabSubmit" type="button" hidden>${ICONS.send}<span>提交实验</span></button>
          <span>Ctrl+Enter 运行</span>
        </div>
        <section class="programming-lab-console" aria-label="运行控制台">
          <header><strong>控制台</strong><span id="programmingLabRunMeta">尚未运行</span></header>
          <pre id="programmingLabOutput">运行后在这里查看真实输出</pre>
        </section>
      </aside>
    </div>
  `;
  initChat(subjectId);
}

async function initChat(subjectId) {
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const quickRepliesEl = document.getElementById('quickReplies');
  const composerHintEl = document.getElementById('composerHint');
  const teacherNudgeEl = document.getElementById('teacherNudge');
  const classroomBoardEl = document.getElementById('classroomBoard');
  const classroomBoardTitleEl = document.getElementById('classroomBoardTitle');
  const classroomBoardItemsEl = document.getElementById('classroomBoardItems');
  const programmingLabEl = document.getElementById('programmingLab');
  const programmingLabResizerEl = document.getElementById('programmingLabResizer');
  const programmingLabEditorEl = document.getElementById('programmingLabEditor');
  const programmingLabOutputEl = document.getElementById('programmingLabOutput');
  const programmingLabRunEl = document.getElementById('programmingLabRun');
  const programmingLabSubmitEl = document.getElementById('programmingLabSubmit');
  let programmingLabEditor = null;
  const taskWorkspaceEl = document.getElementById('taskWorkspace');
  const taskLabelEl = document.getElementById('taskLabel');
  const taskKnowledgePointEl = document.getElementById('taskKnowledgePoint');
  const taskExpectedEl = document.getElementById('taskExpected');
  const taskPromptEl = document.getElementById('taskPrompt');
  const taskOriginalEl = document.getElementById('taskOriginal');
  const taskAnswerEl = document.getElementById('taskAnswer');
  const taskSubmitEl = document.getElementById('taskSubmit');
  const taskResizeHandleEl = document.getElementById('taskResizeHandle');
  const taskCodeEditorEl = document.getElementById('taskCodeEditor');
  const taskPanelToggleEl = document.getElementById('taskPanelToggle');
  let taskCodeEditor = null;
  let taskCodeEditorRequest = 0;
  let taskHintIndex = 0;

  const setTaskPanelCollapsed = (collapsed, { focusEditor = false } = {}) => {
    const shouldCollapse = Boolean(collapsed && taskWorkspaceEl?.dataset.editorType === 'code');
    taskWorkspaceEl?.classList.toggle('is-collapsed', shouldCollapse);
    messagesEl?.classList.toggle('task-panel-collapsed', shouldCollapse);
    if (taskPanelToggleEl) {
      taskPanelToggleEl.setAttribute('aria-expanded', String(!shouldCollapse));
      taskPanelToggleEl.setAttribute('aria-label', shouldCollapse ? '展开练习编辑器' : '收起练习编辑器');
      taskPanelToggleEl.title = shouldCollapse ? '展开练习编辑器' : '收起练习编辑器';
    }
    if (!shouldCollapse && focusEditor) requestAnimationFrame(() => taskCodeEditor?.focus());
  };

  const syncTaskCodeEditor = async (enabled) => {
    const request = ++taskCodeEditorRequest;
    if (!enabled) {
      taskCodeEditor?.destroy();
      taskCodeEditor = null;
      if (taskCodeEditorEl) taskCodeEditorEl.hidden = true;
      if (taskAnswerEl) taskAnswerEl.hidden = false;
      return;
    }
    if (taskAnswerEl) taskAnswerEl.hidden = true;
    if (taskCodeEditorEl) taskCodeEditorEl.hidden = false;
    if (taskCodeEditor) {
      taskCodeEditor.setValue(taskAnswerEl?.value || '');
      return;
    }
    try {
      const { createTaskCodeEditor } = await import('./codemirror-setup.js');
      if (request !== taskCodeEditorRequest || !taskCodeEditorEl?.isConnected) return;
      taskCodeEditor = createTaskCodeEditor(taskCodeEditorEl, {
        initialCode: taskAnswerEl?.value || '',
        placeholder: '编写完整代码，Ctrl+Enter 提交…',
        onChange(value) {
          if (!taskAnswerEl || taskAnswerEl.value === value) return;
          taskAnswerEl.value = value;
          taskAnswerEl.dispatchEvent(new Event('input', { bubbles: true }));
          taskCodeEditorEl?.classList.toggle('has-draft', Boolean(value.trim()));
        },
        onSubmit: () => taskSubmitEl?.click(),
      });
    } catch (error) {
      console.warn('课堂代码编辑器初始化失败，回退到文本编辑:', error);
      if (taskCodeEditorEl) taskCodeEditorEl.hidden = true;
      if (taskAnswerEl) taskAnswerEl.hidden = false;
    }
  };
  const taskHintEl = document.getElementById('taskHint');
  const taskAlternateEl = document.getElementById('taskAlternate');
  const taskStatusEl = document.getElementById('taskStatus');
  const taskObserverControlEl = document.getElementById('taskObserverControl');
  const taskObserverToggleEl = document.getElementById('taskObserverToggle');
  const draftCoachEl = document.getElementById('draftCoach');
  const draftCoachTitleEl = document.getElementById('draftCoachTitle');
  const draftCoachMessageEl = document.getElementById('draftCoachMessage');
  const draftCoachDismissEl = document.getElementById('draftCoachDismiss');
  const composerShellEl = taskWorkspaceEl?.closest('.composer-shell');
  let resumeContext = null;
  let proactiveTimer = null;
  let taskDraftSaveTimer = null;
  let draftObservationTimer = null;
  let draftObservationRequestId = 0;
  let draftObservationInFlightId = 0;
  let draftObservationState = createDraftObservationState();
  let queuedTeacherContinuation = null;
  let continuationStarting = false;
  let createdGreeting = false;
  let renderedTaskKey = '';
  const draftStorageKey = taskDraftStorageKey(subjectId);
  const readLocalValue = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const writeLocalValue = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch { /* WebView storage unavailable */ }
  };
  const removeLocalValue = key => {
    try { localStorage.removeItem(key); } catch { /* WebView storage unavailable */ }
  };
  let draftObservationEnabled = readLocalValue(DRAFT_OBSERVER_PREFERENCE_KEY) !== 'off';
  if (!messagesEl || !inputEl || !sendBtn) return;

  function renderClassroomBoard(board) {
    const items = Array.isArray(board?.items) ? board.items : [];
    if (!classroomBoardEl || !classroomBoardItemsEl || !items.length) {
      if (classroomBoardEl) classroomBoardEl.hidden = true;
      return;
    }
    classroomBoardTitleEl.textContent = String(board.title || '当前要点');
    classroomBoardItemsEl.replaceChildren();
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'classroom-board-item';
      const marker = document.createElement('span');
      marker.textContent = String(index + 1);
      marker.setAttribute('aria-hidden', 'true');
      const content = document.createElement('span');
      content.textContent = String(item || '');
      row.append(marker, content);
      classroomBoardItemsEl.appendChild(row);
    });
    classroomBoardEl.hidden = false;
  }

  function clearDraftObservationTimer() {
    if (!draftObservationTimer) return;
    clearTimeout(draftObservationTimer);
    draftObservationTimer = null;
  }

  function hideDraftCoach() {
    if (!draftCoachEl) return;
    draftCoachEl.hidden = true;
    draftCoachEl.className = 'draft-coach';
  }

  function renderDraftCoach(feedback) {
    if (!draftCoachEl || !draftCoachTitleEl || !draftCoachMessageEl || !feedback) return;
    draftCoachEl.className = `draft-coach is-${feedback.tone}`;
    draftCoachTitleEl.textContent = feedback.title;
    draftCoachMessageEl.textContent = feedback.message;
    draftCoachEl.hidden = false;
  }

  function resetDraftObservation(taskKey = '') {
    clearDraftObservationTimer();
    draftObservationRequestId += 1;
    draftObservationState = createDraftObservationState(taskKey);
    hideDraftCoach();
  }

  function saveCurrentTaskDraft() {
    taskDraftSaveTimer = null;
    const taskKey = taskWorkspaceEl?.dataset.taskKey || '';
    if (!taskKey || !taskAnswerEl) return;
    const content = taskAnswerEl.value;
    if (!content.trim()) {
      removeLocalValue(draftStorageKey);
      if (taskStatusEl && !taskAnswerEl.disabled) {
        taskStatusEl.textContent = draftObservationEnabled && !taskObserverControlEl?.hidden
          ? '草稿自动保存 · 老师观察中'
          : '等待作答';
      }
      return;
    }
    writeLocalValue(draftStorageKey, serializeTaskDraft({ taskKey, content }));
    if (taskStatusEl && !taskAnswerEl.disabled) {
      taskStatusEl.textContent = draftObservationEnabled && !taskObserverControlEl?.hidden
        ? '草稿已保存 · 老师观察中'
        : '草稿已保存';
    }
  }

  function scheduleTaskDraftSave() {
    if (taskDraftSaveTimer) clearTimeout(taskDraftSaveTimer);
    taskDraftSaveTimer = setTimeout(saveCurrentTaskDraft, 350);
  }

  function scheduleDraftObservation(delay = 6000) {
    clearDraftObservationTimer();
    if (!draftObservationEnabled || taskObserverControlEl?.hidden || taskAnswerEl?.disabled) return;
    draftObservationTimer = setTimeout(() => {
      draftObservationTimer = null;
      void observeCurrentDraft();
    }, Math.max(500, delay));
  }

  async function observeCurrentDraft() {
    if (!taskAnswerEl?.isConnected || taskAnswerEl.disabled || document.hidden
      || !draftObservationEnabled || taskObserverControlEl?.hidden) return;
    if (draftObservationInFlightId) {
      scheduleDraftObservation(1500);
      return;
    }
    const session = state.teachingSessions[subjectId] || {};
    const task = session.pendingStudentTask || null;
    const draft = taskAnswerEl.value;
    const eligibility = shouldObserveStudentDraft({
      task,
      draft,
      enabled: draftObservationEnabled,
      state: draftObservationState,
      pendingAction: session.pendingAction,
    });
    if (!eligibility.eligible) {
      if (eligibility.reason === 'cooldown') {
        const remaining = Math.max(1000, 30_000 - (Date.now() - draftObservationState.lastObservedAt));
        scheduleDraftObservation(remaining);
      }
      return;
    }

    const requestId = draftObservationRequestId + 1;
    draftObservationRequestId = requestId;
    draftObservationInFlightId = requestId;
    const snapshot = {
      taskKey: task.key,
      draft,
      fingerprint: eligibility.fingerprint,
      requestId,
    };
    draftObservationState = {
      taskKey: task.key,
      count: draftObservationState.count + 1,
      lastFingerprint: eligibility.fingerprint,
      lastDraft: draft,
      lastObservedAt: Date.now(),
    };
    hideDraftCoach();
    if (taskStatusEl) taskStatusEl.textContent = '老师正在看你写到哪一步…';

    try {
      const rawVerification = await invoke('verify_student_answer', {
        baseUrl: APP_CONFIG.base_url,
        apiKey: APP_CONFIG.api_key,
        model: APP_CONFIG.models.fast || APP_CONFIG.models.chat,
        taskJson: JSON.stringify(task),
        studentAnswer: draft,
        contextJson: JSON.stringify({
          subject: subjectName,
          lessonFocus: teacherBrief.focus,
          lessonGoal: teacherBrief.goal,
          lessonPhase: teacherBrief.lessonStep?.phase || teacherBrief.phase,
          provisionalDraft: true,
        }),
      });
      const verification = normalizeAnswerVerification(rawVerification, {
        studentAnswer: draft,
        task,
      });
      const currentSession = state.teachingSessions[subjectId] || {};
      const snapshotCurrent = isDraftObservationSnapshotCurrent(snapshot, {
        task: currentSession.pendingStudentTask,
        draft: taskAnswerEl.value,
        enabled: draftObservationEnabled && !taskObserverControlEl?.hidden,
        requestId: draftObservationRequestId,
      });
      if (!snapshotCurrent || !taskAnswerEl.isConnected || taskAnswerEl.disabled) return;
      const feedback = deriveDraftCoachingFeedback(verification);
      if (feedback) {
        renderDraftCoach(feedback);
        if (taskStatusEl) taskStatusEl.textContent = '草稿已保存 · 老师给了一步临时反馈';
      } else if (taskStatusEl) {
        taskStatusEl.textContent = '草稿已保存 · 提交后老师会完整检查';
      }
    } catch (error) {
      const currentSession = state.teachingSessions[subjectId] || {};
      if (isDraftObservationSnapshotCurrent(snapshot, {
        task: currentSession.pendingStudentTask,
        draft: taskAnswerEl.value,
        enabled: draftObservationEnabled && !taskObserverControlEl?.hidden,
        requestId: draftObservationRequestId,
      }) && taskStatusEl) {
        taskStatusEl.textContent = '草稿已保存 · 临时观察不可用，提交后仍会完整检查';
      }
      console.warn('草稿临时观察失败:', error);
    } finally {
      if (draftObservationInFlightId === requestId) draftObservationInFlightId = 0;
    }
  }

  function renderClassroomWorkspace({ busy = false, statusText = '', preserveAnswer = false } = {}) {
    const session = state.teachingSessions[subjectId] || {};
    const lessonWorkspaceKey = deriveLessonWorkspaceKey({ lessonPlan: session.lessonPlan, brief: teacherBrief });
    const visibleBoard = applyTeachingBoardUpdate(
      session.teachingBoard,
      { mode: 'keep' },
      { lessonKey: lessonWorkspaceKey },
    );
    renderClassroomBoard(visibleBoard);
    const taskView = deriveClassroomTaskWorkspace(session.pendingStudentTask, {
      pendingAction: session.pendingAction,
    });
    const programmingLabOwnsTask = Boolean(
      session.programmingLab?.taskKey
      && session.programmingLab.taskKey === session.pendingStudentTask?.key,
    );
    if (!taskWorkspaceEl || !taskView.visible || programmingLabOwnsTask) {
      void syncTaskCodeEditor(false);
      setTaskPanelCollapsed(false);
      messagesEl.classList.remove('has-active-task');
      composerShellEl?.classList.remove('has-active-task');
      composerShellEl?.removeAttribute('data-task-editor');
      if (taskWorkspaceEl) taskWorkspaceEl.hidden = true;
      if (taskObserverControlEl) taskObserverControlEl.hidden = true;
      clearDraftObservationTimer();
      draftObservationRequestId += 1;
      hideDraftCoach();
      renderedTaskKey = '';
      const lessonPhase = session.lessonPlan?.steps?.[session.lessonProgress?.currentStep]?.phase;
      if (composerHintEl) composerHintEl.textContent = programmingLabOwnsTask
        ? '在动手实验区运行并提交，仍可在这里向老师提问'
        : lessonPhase === 'explain'
        ? '老师正在讲解，可随时追问'
        : '自由提问或补充说明';
      return;
    }

    const taskChanged = renderedTaskKey !== taskView.taskKey;
    renderedTaskKey = taskView.taskKey;
    taskWorkspaceEl.dataset.taskKey = taskView.taskKey;
    taskWorkspaceEl.dataset.answerMode = taskView.answerMode;
    taskWorkspaceEl.dataset.editorType = /(?:代码|程序|编程|函数|方法|类|循环|Java|Python|JavaScript|C\+\+|SQL)/iu.test(
      `${taskView.prompt} ${taskView.expectedResponse}`,
    ) ? 'code' : 'text';
    if (composerShellEl) composerShellEl.dataset.taskEditor = taskWorkspaceEl.dataset.editorType;
    void syncTaskCodeEditor(taskWorkspaceEl.dataset.editorType === 'code');
    if (taskChanged) setTaskPanelCollapsed(taskWorkspaceEl.dataset.editorType === 'code');
    else if (taskWorkspaceEl.dataset.editorType !== 'code') setTaskPanelCollapsed(false);
    taskLabelEl.textContent = taskView.label;
    taskKnowledgePointEl.textContent = taskView.knowledgePoint || '课堂检查';
    taskExpectedEl.textContent = `回答格式：${taskView.expectedResponse}`;
    taskPromptEl.replaceChildren();
    appendInlineCode(taskPromptEl, taskView.prompt);
    if (taskOriginalEl) {
      taskOriginalEl.textContent = taskView.originalPrompt ? `原任务：${taskView.originalPrompt}` : '';
      taskOriginalEl.hidden = !taskView.originalPrompt || taskView.originalPrompt === taskView.prompt;
    }
    taskAnswerEl.rows = taskView.answerMode === 'extended' ? 4 : 2;
    if (taskChanged) {
      taskHintIndex = 0;
      taskCodeEditorEl?.classList.remove('show-hint');
      resetDraftObservation(taskView.taskKey);
      if (!preserveAnswer) {
        taskAnswerEl.value = restoreTaskDraft(readLocalValue(draftStorageKey), {
          taskKey: taskView.taskKey,
        });
      }
    }
    taskAnswerEl.disabled = busy;
    taskSubmitEl.disabled = busy;
    taskHintEl.disabled = busy;
    taskAlternateEl.disabled = busy;
    taskHintEl.hidden = !taskView.allowSupportActions;
    taskAlternateEl.hidden = !taskView.allowSupportActions;
    renderQuickReplyButtons(quickRepliesEl, taskView.quickReplies);
    if (taskCodeEditorEl) {
      taskCodeEditorEl.dataset.ghostHint = taskView.hints[0] || '';
      taskCodeEditorEl.classList.toggle('has-draft', Boolean(taskAnswerEl.value.trim()));
    }
    if (taskObserverControlEl && taskObserverToggleEl) {
      taskObserverControlEl.hidden = !taskView.allowDraftObservation;
      taskObserverToggleEl.checked = draftObservationEnabled;
      taskObserverToggleEl.disabled = busy;
    }
    if (!taskView.allowDraftObservation) {
      clearDraftObservationTimer();
      hideDraftCoach();
    }
    const idleStatus = taskView.allowDraftObservation
      ? (draftObservationEnabled ? '草稿自动保存 · 老师观察中' : '草稿自动保存 · 老师观察已暂停')
      : '等待作答';
    const resolvedStatus = statusText || (busy ? '已提交，老师正在阅读' : idleStatus);
    taskStatusEl.textContent = resolvedStatus === '等待作答' ? '' : resolvedStatus;
    if (composerHintEl) composerHintEl.textContent = '完成当前任务后可继续自由提问';
    messagesEl.classList.add('has-active-task');
    composerShellEl?.classList.add('has-active-task');
    taskWorkspaceEl.hidden = false;
    if (taskChanged) requestAnimationFrame(() => { taskWorkspaceEl.scrollTop = 0; });
  }

  const flushTeacherContinuation = async ({ studentInitiated = false } = {}) => {
    if (continuationStarting || !queuedTeacherContinuation || sendBtn.disabled || !messagesEl.isConnected) return;
    const continuation = queuedTeacherContinuation;
    queuedTeacherContinuation = null;
    const session = state.teachingSessions[subjectId] || {};
    if (session.lastTeacherContinuationKey === continuation.key) return;
    if (studentInitiated) {
      const studentBubble = makeRow('me');
      renderRichMessage(studentBubble, '继续');
      history.push({ role: 'user', content: '继续' });
      try {
        await invoke('save_chat_message', { subjectId, role: 'user', content: '继续' });
      } catch (error) {
        console.warn('保存学生继续操作失败:', error);
      }
    }
    continuationStarting = true;
    await persistTeachingSession(subjectId, {
      lastTeacherContinuationKey: continuation.key,
      lastTeacherContinuationKind: continuation.kind,
      pendingTeacherContinuation: null,
    });
    continuationStarting = false;
    void send(continuation.command, {
      hideStudentMessage: true,
      internalCommand: true,
      continuationKind: continuation.kind,
    });
  };
  const queueTeacherContinuation = continuation => {
    if (!continuation) return;
    const session = state.teachingSessions[subjectId] || {};
    if (session.lastTeacherContinuationKey === continuation.key) return;
    queuedTeacherContinuation = continuation;
    void persistTeachingSession(subjectId, { pendingTeacherContinuation: continuation });
    const existingReplies = [...(quickRepliesEl?.querySelectorAll('[data-reply]') || [])]
      .map(button => button.dataset.reply)
      .filter(Boolean);
    renderQuickReplyButtons(quickRepliesEl, [...existingReplies, '继续', '先停一下']);
  };

  inputEl.disabled = true;
  sendBtn.disabled = true;

  const subject = state.subjects.find(s => s.id === subjectId);
  const subjectName = subject ? subject.name : '学习';
  let teacherBrief = buildTeacherBrief({ subjectName, assessed: Boolean(subject?.assessed) });

  try {
    let [currentLesson, knowledgePoints, recentEvents, mistakes, savedSessionJson] = await Promise.all([
      invoke('get_current_lesson', { subjectId }).catch(() => null),
      invoke('get_knowledge_points', { subjectId }).catch(() => []),
      invoke('get_learning_events', { subjectId }).catch(() => []),
      invoke('get_mistakes', { subjectId }).catch(() => []),
      invoke('get_teaching_session', { subjectId }).catch(() => null),
    ]);
    let savedSession = null;
    try { savedSession = savedSessionJson ? JSON.parse(savedSessionJson) : null; } catch {}
    const teachingPreferences = normalizeTeachingPreferences(savedSession?.teachingPreferences);
    const ensuredLesson = await ensureLessonPlan({
      subjectId,
      subjectName,
      assessed: Boolean(subject?.assessed),
      currentLesson,
      knowledgePoints,
      recentEvents,
      mistakes,
      lastLessonSummary: savedSession?.lastLessonSummary || null,
      teachingPreferences,
    });
    currentLesson = ensuredLesson.currentLesson;
    const lessonPlan = ensuredLesson.plan;
    const learnerProfile = buildLearnerProfile(
      knowledgePoints,
      mistakes,
      recentEvents,
      savedSession?.lastLessonSummary || null,
      new Date(),
      teachingPreferences,
    );
    const lessonProgress = ensuredLesson.created
      ? {
        currentStep: 0,
        attempts: 0,
        status: 'active',
        gateVersion: 1,
        legacyThroughStep: -1,
        evidenceLedger: { records: [] },
      }
      : savedSession?.lessonProgress || { currentStep: 0, attempts: 0, status: 'active' };
    const existingWarmup = ensuredLesson.created ? null : savedSession?.reviewWarmup || null;
    const shouldPlanWarmup = Boolean(subject?.assessed)
      && !savedSession?.lessonStarted
      && !savedSession?.skipOpeningWarmup
      && !savedSession?.pendingAction
      && !savedSession?.activeIntervention
      && Number(lessonProgress.currentStep || 0) === 0;
    const warmupPlan = shouldPlanWarmup
      ? planRetrievalWarmup({ learnerProfile, lessonPlan, existingWarmup })
      : null;
    const reviewWarmup = warmupPlan?.warmup || existingWarmup;
    const derivedBrief = buildTeacherBrief({
      subjectName,
      assessed: Boolean(subject?.assessed),
      currentLesson,
      knowledgePoints,
      recentEvents,
      lessonPlan,
      lessonProgress,
      learnerProfile,
      teachingPreferences,
      teachingMemory: learnerProfile.teachingMemory,
      activeIntervention: savedSession?.activeIntervention || null,
      reviewWarmup,
    });
    resumeContext = {
      currentLesson,
      knowledgePoints,
      recentEvents,
      mistakes,
      brief: derivedBrief,
      lessonPlan,
      openingWarmupContinuation: warmupPlan?.continuation || null,
    };
    teacherBrief = derivedBrief;
    const pendingStudentTask = ensuredLesson.created || !savedSession?.pendingStudentTask
      ? null
      : normalizeStudentTask(savedSession.pendingStudentTask, {
        teacherMove: savedSession.lastTeacherMove?.move || '',
        checkpoint: savedSession.lastTeacherMove?.checkpoint || '',
        knowledgePoint: derivedBrief.focus,
      });
    const lessonLifecycle = ensuredLesson.created
      ? {
        lessonStarted: false,
        lastProactiveNudgeKey: null,
        lastTeacherContinuationKey: null,
        lastTeacherContinuationKind: null,
        reviewWarmup,
      }
      : {};
    state.teachingSessions[subjectId] = {
      ...(savedSession || {}),
      brief: teacherBrief,
      lessonPlan,
      lessonProgress,
      learnerProfile,
      teachingPreferences,
      reviewWarmup,
      pendingStudentTask,
      ...lessonLifecycle,
    };
    await persistTeachingSession(subjectId, {
      brief: teacherBrief,
      lessonPlan,
      lessonProgress,
      learnerProfile,
      teachingPreferences,
      reviewWarmup,
      pendingStudentTask,
      ...lessonLifecycle,
    });
  } catch (error) {
    console.warn('读取教师教学简报失败:', error);
  }

  let labDraftTimer = null;
  const renderProgrammingLab = async (rawLab = null) => {
    if (!programmingLabEl || !programmingLabEditorEl) return;
    const session = state.teachingSessions[subjectId] || {};
    const source = rawLab || session.programmingLab || createJavaLabForFocus(teacherBrief.focus);
    const activeLabTaskKey = session.pendingStudentTask?.kind === 'practice'
      ? session.pendingStudentTask.key
      : '';
    const lab = normalizeCodingLab(source, {
      focus: teacherBrief.focus,
      taskKey: activeLabTaskKey,
    });
    if (!lab) return;
    const restored = session.programmingLab?.id === lab.id
      ? { ...lab, ...session.programmingLab, initialCode: lab.initialCode }
      : lab;
    await persistTeachingSession(subjectId, { programmingLab: restored, programmingLabOpen: true });
    programmingLabEl.hidden = false;
    if (programmingLabResizerEl) {
      programmingLabResizerEl.hidden = false;
      programmingLabResizerEl.setAttribute('aria-orientation', matchMedia('(max-width: 1450px)').matches ? 'horizontal' : 'vertical');
    }
    document.getElementById('programmingLabTitle').textContent = restored.title;
    const fileTab = programmingLabEl.querySelector('.programming-lab-tabs button');
    if (fileTab) fileTab.textContent = restored.fileName;
    document.getElementById('programmingLabGoal').textContent = restored.goal;
    document.getElementById('programmingLabObservations').innerHTML = restored.observations
      .map(item => `<li>${escapeHtml(item)}</li>`).join('');
    const result = restored.runResult;
    programmingLabOutputEl.textContent = result
      ? [result.stdout, result.stderr].filter(Boolean).join('\n') || '程序没有输出'
      : '运行后在这里查看真实输出';
    const runMeta = document.getElementById('programmingLabRunMeta');
    if (runMeta) runMeta.textContent = result
      ? `${result.success ? '运行成功' : '运行失败'} · ${result.executionTimeMs} ms`
      : '尚未运行';
    if (programmingLabSubmitEl) programmingLabSubmitEl.hidden = !(restored.taskKey && restored.runResult);
    if (!programmingLabEditor) {
      const { createTaskCodeEditor } = await import('./codemirror-setup.js');
      programmingLabEditor = createTaskCodeEditor(programmingLabEditorEl, {
        initialCode: restored.code,
        language: 'java',
        placeholder: '在这里编写 Java 代码…',
        onSubmit: () => programmingLabRunEl?.click(),
        onChange: code => {
          const current = state.teachingSessions[subjectId]?.programmingLab;
          if (!current) return;
          const changed = { ...current, code, dirty: code !== current.initialCode, status: 'ready', runResult: null };
          state.teachingSessions[subjectId].programmingLab = changed;
          if (programmingLabSubmitEl) programmingLabSubmitEl.hidden = true;
          clearTimeout(labDraftTimer);
          labDraftTimer = setTimeout(() => void persistTeachingSession(subjectId, { programmingLab: changed }), 450);
        },
      });
    } else {
      programmingLabEditor.setValue(restored.code);
    }
    invoke('check_java_runtime').then(version => {
      const runtime = document.getElementById('programmingLabRuntime');
      if (runtime) runtime.textContent = version;
    }).catch(error => {
      const runtime = document.getElementById('programmingLabRuntime');
      if (runtime) runtime.textContent = String(error || 'JDK 不可用');
      if (programmingLabRunEl) programmingLabRunEl.disabled = true;
    });
  };

  const closeProgrammingLab = () => {
    if (programmingLabEl) programmingLabEl.hidden = true;
    if (programmingLabResizerEl) programmingLabResizerEl.hidden = true;
    void persistTeachingSession(subjectId, { programmingLabOpen: false });
  };

  const teacherPhase = document.getElementById('teacherPhase');
  const teacherGoal = document.getElementById('teacherGoal');
  const teacherNext = document.getElementById('teacherNext');
  const syncTeacherBrief = () => {
    const plan = state.teachingSessions[subjectId]?.lessonPlan;
    const stepIndex = plan?.steps?.findIndex(step => step.id === teacherBrief.lessonStep?.id) ?? -1;
    const stepCount = plan?.steps?.length || 0;
    if (teacherPhase) teacherPhase.textContent = stepIndex >= 0
      ? `${teacherBrief.phaseLabel} · ${stepIndex + 1}/${stepCount}`
      : teacherBrief.phaseLabel;
    if (teacherGoal) teacherGoal.textContent = teacherBrief.goal;
    if (teacherNext) teacherNext.textContent = teacherBrief.nextAction;
    updateLessonRhythm(teacherBrief.lessonStep?.phase || teacherBrief.phase);
  };
  syncTeacherBrief();
  const syncVerifiedKnowledgePoint = update => {
    if (!update || !resumeContext) return;
    const points = Array.isArray(resumeContext.knowledgePoints) ? resumeContext.knowledgePoints : [];
    const existing = points.find(point => point.name === update.knowledgePoint);
    if (existing) {
      existing.mastery = update.mastery;
      existing.confidence = update.confidence;
    } else {
      points.push({ name: update.knowledgePoint, mastery: update.mastery, confidence: update.confidence });
    }
    resumeContext.knowledgePoints = points;
  };
  const cacheLearningEvent = (eventType, knowledgePoints, detail, createdAt = new Date().toISOString()) => {
    if (!resumeContext) return;
    const events = Array.isArray(resumeContext.recentEvents) ? resumeContext.recentEvents : [];
    events.unshift({
      event_type: eventType,
      knowledge_points_json: JSON.stringify(knowledgePoints || []),
      detail_json: JSON.stringify(detail || {}),
      created_at: createdAt,
    });
    resumeContext.recentEvents = events;
  };
  const rebuildLongitudinalTeacherContext = ({
    session = state.teachingSessions[subjectId] || {},
    lessonProgress = session.lessonProgress,
    activeIntervention = session.activeIntervention || null,
    reviewWarmup = session.reviewWarmup || null,
  } = {}) => {
    const learnerProfile = buildLearnerProfile(
      resumeContext?.knowledgePoints || [],
      resumeContext?.mistakes || [],
      resumeContext?.recentEvents || [],
      session.lastLessonSummary || null,
      new Date(),
      session.teachingPreferences,
    );
    teacherBrief = buildTeacherBrief({
      subjectName,
      assessed: Boolean(subject?.assessed),
      currentLesson: resumeContext?.currentLesson,
      knowledgePoints: resumeContext?.knowledgePoints || [],
      recentEvents: resumeContext?.recentEvents || [],
      lessonPlan: session.lessonPlan,
      lessonProgress,
      learnerProfile,
      teachingPreferences: session.teachingPreferences,
      teachingMemory: learnerProfile.teachingMemory,
      activeIntervention,
      reviewWarmup,
    });
    if (resumeContext) resumeContext.brief = teacherBrief;
    syncTeacherBrief();
    return { learnerProfile, brief: teacherBrief };
  };
  const recordTeachingStrategyOutcome = async ({
    session,
    pendingStudentTask,
    studentTurnType,
    studentStateUpdate,
  }) => {
    const outcome = deriveTeachingStrategyOutcome({
      lastTeacherMove: session?.lastTeacherMove || null,
      activeIntervention: session?.activeIntervention || null,
      pendingStudentTask,
      studentTurnType,
      studentStateUpdate,
    });
    if (!outcome) return null;
    await logLearningEvent(subjectId, 'teacher_strategy_outcome', [outcome.knowledgePoint], outcome);
    cacheLearningEvent('teacher_strategy_outcome', [outcome.knowledgePoint], outcome);
    return outcome;
  };
  const deriveInterventionTransition = ({
    rawDiagnosis = null,
    studentMessage = '',
    studentStateUpdate = null,
    studentTurnType = 'attempt',
  } = {}) => {
    const previousIntervention = state.teachingSessions[subjectId]?.activeIntervention || null;
    let diagnosis = Number(studentStateUpdate?.delta) > 0 ? null : normalizeLearningDiagnosis(rawDiagnosis, {
      studentMessage,
      studentStateUpdate,
      fallbackKnowledgePoint: teacherBrief.focus,
      previousIntervention,
    });
    if (!diagnosis && (Number(studentStateUpdate?.delta) < 0 || studentTurnType === 'stuck')) {
      const evidenceQuote = String(studentMessage || '').trim().slice(0, 160);
      diagnosis = normalizeLearningDiagnosis({
        category: 'unknown',
        knowledge_point: studentStateUpdate?.knowledgePoint || teacherBrief.focus,
        evidence_quote: evidenceQuote,
        evidence: studentStateUpdate?.evidence || '学生明确表示当前任务无法继续',
      }, {
        studentMessage,
        studentStateUpdate,
        fallbackKnowledgePoint: teacherBrief.focus,
        previousIntervention,
      });
    }
    return {
      diagnosis,
      ...updateLearningIntervention(previousIntervention, { diagnosis, studentStateUpdate }),
    };
  };
  const logInterventionTransition = async transition => {
    if (transition?.diagnosis) {
      await logLearningEvent(subjectId, 'teacher_diagnosis', [transition.diagnosis.knowledgePoint], {
        category: transition.diagnosis.category,
        label: transition.diagnosis.label,
        evidence: transition.diagnosis.evidence,
        evidenceQuote: transition.diagnosis.evidenceQuote,
        verifiedPartExcerpt: transition.diagnosis.verifiedPartExcerpt || '',
        correctionFocus: transition.diagnosis.correctionFocus || '',
        source: transition.diagnosis.source || 'teacher',
        occurrences: transition.diagnosis.occurrences,
        level: transition.diagnosis.level,
        strategy: transition.diagnosis.strategy,
      });
    }
    if (transition?.resolvedIntervention) {
      await logLearningEvent(subjectId, 'teacher_intervention_resolved', [transition.resolvedIntervention.knowledgePoint], {
        category: transition.resolvedIntervention.category,
        occurrences: transition.resolvedIntervention.occurrences,
        evidence: transition.resolvedIntervention.resolutionEvidence,
      });
    }
  };
  commitQuizEvidence = async evidence => {
    if (!evidence || evidence.subjectId !== subjectId) return null;
    const supportLevel = evidence.correct && evidence.attempt > 1 ? 'prompted' : 'independent';
    const rawUpdate = {
      knowledge_point: evidence.knowledgePoint,
      mastery_delta: evidence.correct ? (supportLevel === 'independent' ? 0.08 : 0.03) : -0.04,
      confidence: evidence.correct ? 0.88 : 0.82,
      evidence: evidence.correct
        ? `学生第${evidence.attempt}次作答“${evidence.answer}”，与标准答案一致`
        : `学生第${evidence.attempt}次作答“${evidence.answer}”，标准答案为“${evidence.correctAnswer}”`,
      support_level: supportLevel,
    };
    const verifiedUpdate = await verifyStudentStateUpdate(subjectId, rawUpdate);
    if (!verifiedUpdate) return null;
    await persistVerifiedStudentStateUpdate(subjectId, verifiedUpdate);
    syncVerifiedKnowledgePoint(verifiedUpdate);
    const interventionTransition = deriveInterventionTransition({
      rawDiagnosis: evidence.correct ? null : {
        category: 'unknown',
        knowledge_point: evidence.knowledgePoint,
        evidence_quote: evidence.answer,
        evidence: `本次答案“${evidence.answer}”与标准答案不一致，但仅凭结果不能确定具体错因`,
      },
      studentMessage: evidence.answer,
      studentStateUpdate: verifiedUpdate,
      studentTurnType: 'attempt',
    });
    const progressEvidence = interventionTransition.activeIntervention && Number(verifiedUpdate.delta) > 0
      ? null
      : verifiedUpdate;
    const session = state.teachingSessions[subjectId] || {};
    await recordTeachingStrategyOutcome({
      session,
      pendingStudentTask: session.pendingStudentTask || null,
      studentTurnType: 'attempt',
      studentStateUpdate: verifiedUpdate,
    });
    const previousProgress = session.lessonProgress;
    const lessonProgress = session.lessonPlan
      ? updateLessonProgress(session.lessonPlan, session.lessonProgress, {
        studentStateUpdate: progressEvidence,
        studentTurnType: 'attempt',
        teachingEvidence: true,
        evidenceContext: {
          source: 'quiz',
          taskKey: `quiz:${evidence.knowledgePoint}:${evidence.question}`,
          taskKind: 'knowledge_check',
          taskKnowledgePoint: evidence.knowledgePoint,
          answer: evidence.answer,
          attempt: evidence.attempt,
        },
      })
      : session.lessonProgress;
    const refreshed = rebuildLongitudinalTeacherContext({
      session,
      lessonProgress,
      activeIntervention: interventionTransition.activeIntervention,
      reviewWarmup: session.reviewWarmup || null,
    });
    await persistTeachingSession(subjectId, {
      lessonProgress,
      brief: teacherBrief,
      learnerProfile: refreshed.learnerProfile,
      activeIntervention: interventionTransition.activeIntervention,
      ...(interventionTransition.resolvedIntervention
        ? { lastResolvedIntervention: interventionTransition.resolvedIntervention }
        : {}),
    });
    await logInterventionTransition(interventionTransition);
    queueTeacherContinuation(planTeacherContinuation({
      lessonPlan: session.lessonPlan,
      previousProgress,
      nextProgress: lessonProgress,
      source: 'quiz',
      evidence: { ...evidence, supportLevel },
      activeIntervention: interventionTransition.activeIntervention,
    }));
    return verifiedUpdate;
  };
  const resumeStrip = document.getElementById('resumeStrip');
  const renderResumeSuggestion = () => {
    if (!resumeStrip || !subject?.assessed || !resumeContext) return;
    const session = state.teachingSessions[subjectId] || {};
    if (!shouldShowCourseResume(session)) {
      resumeStrip.hidden = true;
      return;
    }
    const currentWarmup = state.teachingSessions[subjectId]?.reviewWarmup;
    const weakest = [...(resumeContext.knowledgePoints || [])]
      .sort((a, b) => Number(a.mastery || 0) - Number(b.mastery || 0))[0];
    const lessonTitle = resumeContext.currentLesson?.title || teacherBrief.focus;
    const warmupActive = currentWarmup && ['scheduled', 'awaiting_response', 'remediate'].includes(currentWarmup.status);
    const lessonCompleted = session.lessonProgress?.status === 'completed';
    const nextLessonFocus = String(session.lastLessonSummary?.next_lesson_focus || '').trim();
    const detail = lessonCompleted
      ? '本节已经完成。新课会沿用当前对话和学习档案，并先由老师讲解。'
      : warmupActive
      ? `老师会先检查“${currentWarmup.knowledgePoint}”，完成后自动进入“${lessonTitle}”。`
      : weakest && Number(weakest.mastery || 0) < 0.65
        ? `上次学到“${lessonTitle}”，先巩固“${weakest.name}”。`
        : `上次学到“${lessonTitle}”，可以从当前进度继续。`;
    document.getElementById('resumeTitle').textContent = lessonCompleted
      ? `下一节：${nextLessonFocus || '继续新的学习重点'}`
      : warmupActive
      ? '课前检索热身'
      : `继续学习：${lessonTitle}`;
    document.getElementById('resumeDetail').textContent = detail;
    const continueButton = document.getElementById('resumeContinue');
    if (continueButton) {
      continueButton.textContent = lessonCompleted ? '开始下一节' : '继续本节';
      continueButton.dataset.action = lessonCompleted ? 'next-lesson' : 'resume';
    }
    const actions = resumeStrip.querySelector('.resume-strip-actions');
    if (actions) actions.hidden = warmupActive;
    resumeStrip.hidden = false;
  };
  renderResumeSuggestion();

  const memoryHistory = (state.chatHistory[subjectId] || [])
    .slice(1)
    .filter(entry => !(entry.role === 'user' && isInternalTeacherCommand(entry.content)));
  let persistedHistory = [];
  try {
    const savedMessages = await invoke('get_chat_history', { subjectId });
    persistedHistory = (savedMessages || []).flatMap(entry => {
      const [role, content] = Array.isArray(entry) ? entry : [entry.role, entry.content];
      if (!['user', 'assistant'].includes(role) || typeof content !== 'string') return [];
      if (role === 'user' && isInternalTeacherCommand(content)) return [];
      return [{
        role,
        content: sanitizeLegacySubjectMessage(content, subject.rawName, role),
      }];
    });
  } catch (error) {
    console.warn('读取课堂历史失败，保留当前内存记录:', error);
  }
  state.chatHistory[subjectId] = reconcileChatHistory({
    systemMessage: buildTeacherSystemPrompt(teacherBrief),
    persistedMessages: persistedHistory,
    memoryHistory,
  });
  const history = state.chatHistory[subjectId];

  if (history.length === 1) {
    const greeting = createTeacherGreeting(teacherBrief);
    history.push({ role: 'assistant', content: greeting });
    createdGreeting = true;
    const greetingTask = normalizeStudentTask({
      kind: subject?.assessed ? 'diagnostic_check' : 'learning_choice',
      prompt: subject?.assessed
        ? `用一句话说明你现在如何理解“${teacherBrief.focus}”`
        : '选择 A、B 或 C，说明目前的学习基础',
      expected_response: subject?.assessed ? '一句具体理解或一个例子' : 'A、B 或 C',
      knowledge_point: teacherBrief.focus,
    }, {
      teacherMove: 'diagnose', checkpoint: '完成开场诊断', knowledgePoint: teacherBrief.focus,
    });
    await persistTeachingSession(subjectId, { pendingStudentTask: greetingTask });
    try {
      await invoke('save_chat_message', { subjectId, role: 'assistant', content: greeting });
    } catch (error) {
      console.warn('保存教师开场白失败:', error);
    }
  }

  if (!messagesEl.isConnected) return;
  for (let index = history.length - 1; index >= 1; index -= 1) {
    if (history[index].role === 'user' && isInternalTeacherCommand(history[index].content)) {
      history.splice(index, 1);
    }
  }
  if (history.length > 2) quickRepliesEl?.classList.add('is-hidden');

  // 渲染已有对话记录
  function renderExistingHistory() {
    let previousStudentMessage = '';
    let previousTeacherVisible = '';
    let pendingExerciseReview = null;
    let historicalPendingTask = null;
    for (let i = 1; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'user') {
        previousStudentMessage = msg.content;
        previousTeacherVisible = '';
        const codeSubmission = getCodeExerciseSubmission(msg.content);
        if (codeSubmission) {
          const exercises = messagesEl.querySelectorAll('.inline-code-exercise:not(.is-submitted)');
          pendingExerciseReview = exercises[exercises.length - 1] || null;
          setInlineCodeExerciseState(pendingExerciseReview, 'submitted', codeSubmission.code);
          continue;
        }
        pendingExerciseReview = null;
        if (isCodeTask(historicalPendingTask) && looksLikeCodeAnswer(msg.content)) {
          renderTaskSubmissionArtifact(msg.content, historicalPendingTask);
        }
        else renderRichMessage(makeRow('me'), formatStudentMessageForDisplay(msg.content));
      } else if (msg.role === 'assistant') {
        const visibleContent = sanitizeLegacySubjectMessage(msg.content, subject?.rawName, msg.role);
        const exerciseReview = pendingExerciseReview;
        const parsed = parseAIResponse(visibleContent);
        const structured = parsed.structured
          ? enforceTeacherTurnPolicy(parsed.structured, previousStudentMessage, teacherBrief, historicalPendingTask)
          : null;
        const teacherMessage = enforceTeacherVisibleMessage(structured?.message || parsed.message, structured);
        const visibleKey = String(teacherMessage || '').replace(/\s+/g, ' ').trim();
        const studentTask = structured?.student_task || (
          createdGreeting && i === history.length - 1
            ? state.teachingSessions[subjectId]?.pendingStudentTask
            : null
        );
        if (!exerciseReview && visibleKey && visibleKey === previousTeacherVisible) {
          historicalPendingTask = studentTask || historicalPendingTask;
          continue;
        }
        const content = exerciseReview
          ? getOrCreateInlineExerciseReview(exerciseReview, `${subjectName}老师 · 批改`)
          : makeRow('teacher');
        renderRichMessage(content, teacherMessage);
        previousTeacherVisible = visibleKey;
        bindTeacherVoiceControl(content, teacherMessage, {
          autoSpeak: createdGreeting && i === history.length - 1,
        });
        const teacherMove = normalizeTeacherMove(structured, teacherBrief.phase);
        if (teacherMove) renderTeacherMoveFooter(content.parentElement, teacherMove, studentTask);
        historicalPendingTask = studentTask || historicalPendingTask;
        if (exerciseReview) {
          setInlineCodeExerciseState(exerciseReview, 'reviewed');
          pendingExerciseReview = null;
        }
      }
    }
  }

  function makeRow(who) {
    const roleClass = who === 'me' ? 'user' : 'bot';
    const previousRow = messagesEl.lastElementChild;
    const previousBubble = previousRow?.classList.contains(roleClass)
      ? previousRow.querySelector(`.msg.${roleClass}`)
      : null;
    if (previousBubble) {
      const segment = document.createElement('div');
      segment.className = 'message-content message-segment';
      previousBubble.appendChild(segment);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return segment;
    }
    const row = document.createElement('div');
    row.className = `row ${roleClass}`;
    const av = document.createElement('div');
    av.className = `mini-avatar ${who === 'me' ? 'student' : 'teacher'}`;
    av.innerHTML = who === 'me' ? AVATAR.me : AVATAR.teacher;
    const bubble = document.createElement('div');
    bubble.className = `msg ${who === 'me' ? 'user' : 'bot'}`;
    row.appendChild(av);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (who === 'teacher') {
      const header = document.createElement('div');
      header.className = 'message-header';
      const label = document.createElement('div');
      label.className = 'message-author';
      label.textContent = `${subjectName}老师 · ${teacherBrief.phaseLabel}`;
      header.append(label, createTeacherVoiceButton());
      const content = document.createElement('div');
      content.className = 'message-content message-segment';
      bubble.append(header, content);
      return content;
    }
    const content = document.createElement('div');
    content.className = 'message-content message-segment';
    bubble.appendChild(content);
    return content;
  }

  function renderStudentTaskSubmission(container, text, task) {
    container.classList.add('task-submission-message');
    const context = document.createElement('div');
    context.className = 'task-submission-context';
    const label = document.createElement('span');
    label.textContent = '我的作答';
    const point = document.createElement('small');
    point.textContent = task?.knowledgePoint || task?.label || '当前任务';
    context.append(label, point);
    const answer = document.createElement('div');
    answer.className = 'task-submission-answer';
    renderRichMessage(answer, formatStudentMessageForDisplay(text));
    container.append(context, answer);
  }

  const isCodeTask = task => /(?:代码|程序|编程|Java|Python|JavaScript|C\+\+|SQL)/iu.test(
    `${task?.prompt || ''} ${task?.expectedResponse || task?.expected_response || ''}`,
  );
  const looksLikeCodeAnswer = text => {
    const value = String(text || '');
    return value.includes('\n') && /(?:\b(?:class|public|static|void|int|for|while|if|return|def|print)\b|[{};])/u.test(value);
  };
  function renderTaskSubmissionArtifact(text, task = null) {
    const artifact = document.createElement('section');
    artifact.className = 'task-submission-artifact';
    artifact.setAttribute('aria-label', '已提交的代码练习');
    const heading = document.createElement('div');
    heading.className = 'task-submission-artifact-heading';
    heading.innerHTML = `${ICONS.check}<span><strong>已提交代码练习</strong><small></small></span>`;
    heading.querySelector('small').textContent = task?.knowledgePoint || task?.label || '课堂练习';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '查看代码';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = String(text || '').trim();
    pre.appendChild(code);
    details.append(summary, pre);
    artifact.append(heading, details);
    messagesEl.appendChild(artifact);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return artifact;
  }

  async function send(
    overrideText = '',
    {
      hideStudentMessage = false,
      internalCommand = false,
      continuationKind = '',
      exerciseTarget = null,
      reuseUserMessage = false,
      sourceTaskKey = '',
      studentAction = '',
    } = {},
  ) {
    const text = String(overrideText || inputEl.value).trim();
    if (!text || sendBtn.disabled) return;
    const sessionAtSubmission = state.teachingSessions[subjectId] || {};
    const taskAtSubmission = sessionAtSubmission.pendingStudentTask || null;
    if (sourceTaskKey && !isCurrentTaskSubmission(taskAtSubmission, sourceTaskKey)) {
      renderClassroomWorkspace();
      showToast('老师已经更新了任务，请按当前任务重新作答', 'warn');
      return;
    }
    if (sourceTaskKey) {
      clearDraftObservationTimer();
      draftObservationRequestId += 1;
      hideDraftCoach();
    }
    releaseStudentVoiceTurn();
    const recordStudentTurn = !internalCommand && !reuseUserMessage;

    if (recordStudentTurn && !hideStudentMessage && !getCodeExerciseSubmission(text)) {
      if (studentAction === 'answer' && sourceTaskKey && isCodeTask(taskAtSubmission)) {
        renderTaskSubmissionArtifact(text, taskAtSubmission);
      } else {
        const studentBubble = makeRow('me');
        if (studentAction === 'answer' && sourceTaskKey) {
          renderStudentTaskSubmission(studentBubble, text, taskAtSubmission);
        } else {
          renderRichMessage(studentBubble, formatStudentMessageForDisplay(text));
        }
      }
    }
    if (proactiveTimer) clearTimeout(proactiveTimer);
    if (teacherNudgeEl) teacherNudgeEl.hidden = true;
    if (exerciseTarget) setInlineCodeExerciseState(exerciseTarget, 'reviewing');
    if (recordStudentTurn) history.push({ role: 'user', content: text });
    const previousTeacherMessage = [...history].reverse().find(item => item.role === 'assistant')?.content || '';
    let classroomSession = sessionAtSubmission;
    const respondingStudentTask = taskAtSubmission;
    const plannedStudentTurnType = internalCommand
      ? 'internal'
      : classifyStudentTurn(text, { pendingStudentTask: respondingStudentTask });
    const requiresAnswerVerification = !internalCommand
      && shouldVerifyStudentAnswer(respondingStudentTask, plannedStudentTurnType);
    if (recordStudentTurn) {
      const preferenceSignal = deriveTeachingPreferenceSignal(text, {
        pendingStudentTask: respondingStudentTask,
      });
      if (preferenceSignal) {
        const recordedAt = new Date().toISOString();
        const teachingPreferences = updateTeachingPreferences(
          classroomSession.teachingPreferences,
          preferenceSignal,
          recordedAt,
        );
        await logLearningEvent(subjectId, 'teaching_preference', [], preferenceSignal);
        cacheLearningEvent('teaching_preference', [], preferenceSignal, recordedAt);
        classroomSession = { ...classroomSession, teachingPreferences };
        const refreshed = rebuildLongitudinalTeacherContext({ session: classroomSession });
        await persistTeachingSession(subjectId, {
          teachingPreferences,
          learnerProfile: refreshed.learnerProfile,
          brief: refreshed.brief,
        });
        classroomSession = state.teachingSessions[subjectId] || classroomSession;
      }
    }
    const studentTurnCount = history.filter(item => item.role === 'user').length;
    if (!internalCommand) inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;
    quickRepliesEl?.classList.add('is-hidden');
    if (composerHintEl) composerHintEl.textContent = '老师正在阅读你的回答…';
    renderClassroomWorkspace({
      busy: true,
      statusText: sourceTaskKey ? '已提交，老师正在阅读' : '老师正在处理你的补充',
      preserveAnswer: true,
    });

    if (recordStudentTurn) logLearningEvent(subjectId, 'chat_turn', [], {
      role: 'user',
      turnType: plannedStudentTurnType,
      respondingToTask: respondingStudentTask ? {
        kind: respondingStudentTask.kind,
        key: respondingStudentTask.key,
        evidenceScope: respondingStudentTask.evidenceScope,
      } : null,
    });

    if (recordStudentTurn) {
      try {
        await invoke('save_chat_message', { subjectId, role: 'user', content: text });
      } catch (error) {
        console.warn('保存学生消息失败:', error);
      }
    }

    const botEl = exerciseTarget
      ? getOrCreateInlineExerciseReview(exerciseTarget, `${subjectName}老师 · 批改`)
      : makeRow('teacher');
    botEl.innerHTML = `<span class="request-state"><span class="typing" aria-hidden="true"><span></span><span></span><span></span></span><span class="request-state-text">${requiresAnswerVerification ? '正在独立核对答案' : '正在理解你的回答'}</span></span>`;
    let botText = '';
    let streamDone = false;
    let responseCompleted = false;
    let answerVerification = null;
    let teacherContentForHistory = '';
    let requestStage = requiresAnswerVerification ? 'verifying' : 'teaching';
    const requestStatus = botEl.querySelector('.request-state-text');
    const statusTimers = [
      setTimeout(() => {
        if (requestStatus) requestStatus.textContent = requestStage === 'verifying'
          ? '正在独立核对答案，模型响应较慢'
          : requestStage === 'reviewing'
            ? '正在复核讲解与题目，模型响应较慢'
            : '正在结合学习档案组织讲解';
      }, 5000),
      setTimeout(() => {
        if (requestStatus) requestStatus.textContent = requestStage === 'verifying'
          ? '仍在核对答案，不会据此提前更新掌握度'
          : requestStage === 'reviewing'
            ? '仍在复核学科结论与隐藏答案键'
            : '模型响应较慢，仍在等待';
      }, 15000),
    ];

    try {
      if (requiresAnswerVerification) {
        try {
          const deterministicTrace = isCodeTask(respondingStudentTask)
            ? traceSimpleJavaAccumulator(text)
            : null;
          const rawVerification = await invoke('verify_student_answer', {
            baseUrl: APP_CONFIG.base_url,
            apiKey: APP_CONFIG.api_key,
            model: APP_CONFIG.models.fast || APP_CONFIG.models.chat,
            taskJson: JSON.stringify({ ...respondingStudentTask, deterministicExecution: deterministicTrace }),
            studentAnswer: text,
            contextJson: JSON.stringify({
              subject: subjectName,
              lessonFocus: teacherBrief.focus,
              lessonGoal: teacherBrief.goal,
              lessonPhase: teacherBrief.lessonStep?.phase || teacherBrief.phase,
              deterministicExecution: deterministicTrace,
            }),
          });
          answerVerification = normalizeAnswerVerification(rawVerification, {
            studentAnswer: text,
            task: respondingStudentTask,
          });
        } catch (error) {
          const reason = typeof error === 'string' ? error : (error?.message || '判卷服务暂时不可用');
          answerVerification = unavailableAnswerVerification(reason);
          console.warn('独立判卷失败，本轮不更新掌握度:', reason);
        }
        await logLearningEvent(subjectId, 'answer_verification', [], {
          verdict: answerVerification.verdict,
          confidence: answerVerification.confidence,
          trusted: answerVerification.trusted,
          taskKey: respondingStudentTask?.key || null,
        });
        requestStage = 'teaching';
        if (requestStatus) requestStatus.textContent = '老师正在根据核对结果组织反馈';
      } else if (!internalCommand && ['attempt', 'submitted_work'].includes(plannedStudentTurnType)
        && !respondingStudentTask) {
        answerVerification = unavailableAnswerVerification('当前没有可判定的待答任务');
      }

      const latestSystemPrompt = { role: 'system', content: buildTeacherSystemPrompt(teacherBrief) };
      if (history[0]?.role === 'system') history[0] = latestSystemPrompt;
      else history.unshift(latestSystemPrompt);
      const baseTurnDirective = internalCommand
        ? text
        : buildTeacherTurnDirective({
          studentMessage: text,
          brief: teacherBrief,
          previousTeacherMessage: parseAIResponse(previousTeacherMessage).message,
          previousTeacherMove: classroomSession.lastTeacherMove?.move || '',
          studentTurnCount,
          pendingStudentTask: respondingStudentTask,
        });
      const verificationDirective = internalCommand
        ? ''
        : buildAnswerVerificationDirective(answerVerification, respondingStudentTask);
      const executionDirective = internalCommand ? '' : formatJavaAccumulatorTrace(traceSimpleJavaAccumulator(text));
      const turnDirective = [baseTurnDirective, verificationDirective, executionDirective].filter(Boolean).join('\n\n');
      const requestMessages = [history[0], { role: 'system', content: turnDirective }, ...history.slice(1)];

      // 先注册监听器，再发起请求（避免事件丢失）
      const requestId = crypto.randomUUID();
      const unlisten = await listen('chat-stream', (event) => {
        const payload = event.payload;
        if (payload.requestId !== requestId) return;
        if (payload.type === 'reasoning') {
          if (requestStatus) requestStatus.textContent = '正在分析你的思路';
        } else if (payload.type === 'content') {
          botText += payload.text;
          if (requestStatus) requestStatus.textContent = '老师正在组织讲解';
        } else if (payload.type === 'done') {
          streamDone = true;
          unlisten();
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });

      // 发起请求
      await invoke('send_chat_stream', {
        baseUrl: APP_CONFIG.base_url,
        apiKey: APP_CONFIG.api_key,
        model: APP_CONFIG.models.chat,
        messagesJson: JSON.stringify(requestMessages),
        requestId,
      });

      if (botText) {
        const parsedTeacherResponse = parseAIResponse(botText);
        if (parsedTeacherResponse.unsafe) throw new Error('老师回复格式不完整，请重新发送');
        let { message: rawMessage, structured: rawStructured } = parsedTeacherResponse;
        teacherContentForHistory = botText;
        let boardUpdateReviewed = false;
        const requiresTeacherReview = shouldReviewTeacherTurn({
          message: rawMessage,
          structured: rawStructured,
          continuationKind,
        });
        if (requiresTeacherReview) {
          requestStage = 'reviewing';
          if (requestStatus) requestStatus.textContent = '正在复核讲解与题目';
          statusTimers.push(
            setTimeout(() => {
              if (requestStage === 'reviewing' && requestStatus) {
                requestStatus.textContent = '正在复核讲解与题目，模型响应较慢';
              }
            }, 5000),
            setTimeout(() => {
              if (requestStage === 'reviewing' && requestStatus) {
                requestStatus.textContent = '仍在复核学科结论与隐藏答案键';
              }
            }, 15000),
          );
          let teacherReview = null;
          try {
            const rawReview = await invoke('review_teacher_turn', {
              baseUrl: APP_CONFIG.base_url,
              apiKey: APP_CONFIG.api_key,
              model: APP_CONFIG.models.fast || APP_CONFIG.models.chat,
              candidateJson: JSON.stringify({ message: rawMessage, structured: rawStructured }),
              contextJson: JSON.stringify({
                subject: subjectName,
                lessonFocus: teacherBrief.focus,
                lessonGoal: teacherBrief.goal,
                lessonPhase: teacherBrief.lessonStep?.phase || teacherBrief.phase,
                answerVerdict: answerVerification?.verdict || null,
                continuationKind: continuationKind || null,
              }),
            });
            teacherReview = normalizeTeacherReview(rawReview, {
              message: rawMessage,
              structured: rawStructured,
            });
          } catch (error) {
            const reason = typeof error === 'string' ? error : (error?.message || '教学复核暂时不可用');
            teacherReview = unavailableTeacherReview(reason);
            console.warn('独立教学复核失败，继续使用客户端保守策略:', reason);
          }
          const reviewed = applyTeacherReview(
            { message: rawMessage, structured: rawStructured },
            teacherReview,
          );
          rawMessage = reviewed.message;
          rawStructured = reviewed.structured;
          boardUpdateReviewed = teacherReview.trusted;
          if (reviewed.revised) {
            teacherContentForHistory = JSON.stringify({ ...rawStructured, message: rawMessage });
          }
          await logLearningEvent(subjectId, 'teacher_content_review', [], {
            verdict: teacherReview.verdict,
            confidence: teacherReview.confidence,
            trusted: teacherReview.trusted,
            revised: reviewed.revised,
            issueCategories: teacherReview.issues.map(item => item.category),
            issueTargets: teacherReview.issues.map(item => item.target),
          });
          requestStage = 'teaching';
        }
        const proposedBoardUpdate = normalizeTeachingBoardUpdate(rawStructured?.board_update);
        if (['replace', 'append'].includes(proposedBoardUpdate.mode) && !boardUpdateReviewed) {
          rawStructured = { ...rawStructured, board_update: { mode: 'keep', title: '', items: [] } };
          teacherContentForHistory = JSON.stringify({ ...rawStructured, message: rawMessage });
        }
        const verificationGuarded = internalCommand || !answerVerification
          ? rawStructured
          : applyAnswerVerificationToTeacherTurn(rawStructured, answerVerification, respondingStudentTask);
        let structured = internalCommand
          ? enforceTeacherContinuationPolicy(
            verificationGuarded, continuationKind, teacherBrief, respondingStudentTask,
          )
          : enforceTeacherTurnPolicy(
            verificationGuarded, text, teacherBrief, respondingStudentTask,
          );
        if (!internalCommand) {
          structured = enforceRepairClosureTurn(
            structured, answerVerification, respondingStudentTask,
          );
          structured = enforceStepwiseCorrectionTask(
            structured, answerVerification, respondingStudentTask,
          );
        }
        if (internalCommand && structured) {
          structured.student_state_update = null;
          structured.learning_diagnosis = null;
        }
        const policyMessage = enforceTeacherVisibleMessage(structured?.message || rawMessage, structured);
        const message = enforceVerifiedTeacherMessage(
          policyMessage, answerVerification, structured, respondingStudentTask,
        );
        if (structured) structured.message = message;
        const studentTurnType = plannedStudentTurnType;
        const normalizedStudentStateUpdate = internalCommand
          ? null
          : await verifyStudentStateUpdate(subjectId, structured?.student_state_update);
        const verifiedStudentStateUpdate = enforceStudentEvidenceSupport(normalizedStudentStateUpdate, {
          activeIntervention: classroomSession.activeIntervention || null,
          reviewWarmup: classroomSession.reviewWarmup || null,
          previousTeacherMove: classroomSession.lastTeacherMove?.move || '',
          pendingStudentTask: respondingStudentTask,
        });
        await appendInstructionEvidence({
          subjectId,
          knowledgePoint: verifiedStudentStateUpdate?.knowledgePoint || teacherBrief.focus,
          structured,
          teacherBrief,
          studentUpdate: verifiedStudentStateUpdate,
          task: respondingStudentTask,
        });
        const taskAllowsDiagnosis = studentTaskAllowsDiagnosisEvidence(respondingStudentTask);
        const interventionTransition = internalCommand || !taskAllowsDiagnosis
          ? {
            diagnosis: null,
            activeIntervention: state.teachingSessions[subjectId]?.activeIntervention || null,
            resolvedIntervention: null,
          }
          : deriveInterventionTransition({
            rawDiagnosis: structured?.learning_diagnosis,
            studentMessage: text,
            studentStateUpdate: verifiedStudentStateUpdate,
            studentTurnType,
          });
        if (structured) structured.learning_diagnosis = interventionTransition.diagnosis;
        const turnQuality = assessTeacherTurnQuality({
          studentMessage: internalCommand ? '' : text,
          message,
          structured,
          pendingStudentTask: respondingStudentTask,
        });
        syncVerifiedKnowledgePoint(verifiedStudentStateUpdate);
        if (!internalCommand) {
          await recordTeachingStrategyOutcome({
            session: classroomSession,
            pendingStudentTask: respondingStudentTask,
            studentTurnType,
            studentStateUpdate: verifiedStudentStateUpdate,
          });
        }
        if (message) {
          renderRichMessage(botEl, message);
          bindTeacherVoiceControl(botEl, message, { autoSpeak: true });
        }
        const teacherMove = normalizeTeacherMove(structured, teacherBrief.phase);
        if (teacherMove && interventionTransition.activeIntervention?.strategy) {
          teacherMove.teachingStrategy = interventionTransition.activeIntervention.strategy;
        }
        const nextStudentTask = teacherMove
          ? normalizeStudentTask(structured?.student_task, {
            teacherMove: teacherMove.move,
            checkpoint: teacherMove.checkpoint,
            knowledgePoint: teacherBrief.focus,
          })
          : null;
        const proposedProgrammingLab = normalizeCodingLab(structured?.coding_lab, {
          focus: teacherBrief.focus,
          taskKey: nextStudentTask?.kind === 'practice' ? nextStudentTask?.key : '',
        });
        let teacherContinuation = internalCommand || teacherBrief.lessonStep?.phase !== 'practice'
          ? null
          : planRepairContinuation({
            task: respondingStudentTask,
            verification: answerVerification,
          });
        if (internalCommand && continuationKind === 'instructional_recheck'
          && nextStudentTask?.kind === 'none') {
          teacherContinuation = {
            kind: 'instructional_recheck_retry',
            key: `instructional-recheck-retry:${Date.now()}`,
            command: `${text}\n\n上一次响应遗漏了可作答的新题。请立即补充一道具体的新同构题，student_task.prompt 必须包含完整题面，不能只写“完成这道新同构题”等动作标签；同时提供明确 expected_response 和隐藏 assessment。不要重复原题讲解，不要公布新题答案。`,
          };
        }
        if (teacherMove) {
          renderTeacherMoveFooter(botEl.parentElement, teacherMove, nextStudentTask);
          const session = state.teachingSessions[subjectId] || {};
          const previousProgress = session.lessonProgress;
          const isReviewResponse = !internalCommand
            && ['awaiting_response', 'remediate'].includes(session.reviewWarmup?.status);
          let nextReviewWarmup = session.reviewWarmup || null;
          if (internalCommand && continuationKind === 'review_warmup' && nextReviewWarmup) {
            nextReviewWarmup = {
              ...nextReviewWarmup,
              status: 'awaiting_response',
              teacherPrompt: message,
              askedAt: new Date().toISOString(),
            };
          } else if (isReviewResponse) {
            nextReviewWarmup = updateRetrievalWarmup(nextReviewWarmup, {
              studentStateUpdate: turnQuality.valid ? verifiedStudentStateUpdate : null,
              activeIntervention: interventionTransition.activeIntervention,
              resolvedIntervention: interventionTransition.resolvedIntervention,
              studentTurnType,
            });
          }
          const progressEvidence = isReviewResponse
            ? null
            : interventionTransition.activeIntervention && Number(verifiedStudentStateUpdate?.delta) > 0
              ? null
              : verifiedStudentStateUpdate;
          const lessonSummary = isReviewResponse || interventionTransition.activeIntervention
            ? null
            : normalizeLessonSummary(
              structured?.lesson_summary,
              session.lessonPlan,
              session.lessonProgress,
            );
          const lessonProgress = session.lessonPlan
            ? updateLessonProgress(session.lessonPlan, session.lessonProgress, {
              teacherMove: teacherMove.move,
              studentStateUpdate: progressEvidence,
              lessonSummary,
              studentTurnType,
              teachingEvidence: turnQuality.valid,
              evidenceContext: respondingStudentTask ? {
                source: exerciseTarget ? 'practice' : 'chat',
                taskKey: respondingStudentTask.key,
                taskKind: respondingStudentTask.kind,
                taskKnowledgePoint: respondingStudentTask.knowledgePoint,
                answer: text,
                attempt: 1,
              } : null,
            })
            : session.lessonProgress;
          if (!teacherContinuation && isReviewResponse && nextReviewWarmup?.status === 'completed') {
            teacherContinuation = planTeacherContinuation({
              lessonPlan: session.lessonPlan,
              previousProgress,
              nextProgress: lessonProgress,
              source: 'review',
              evidence: {
                warmupCompleted: true,
                correct: true,
                answer: text,
                knowledgePoint: nextReviewWarmup.knowledgePoint,
                supportLevel: verifiedStudentStateUpdate?.supportLevel || 'independent',
              },
            });
          } else if (!teacherContinuation && !isReviewResponse
            && (!internalCommand || !continuationKind)) {
            teacherContinuation = planTeacherContinuation({
              lessonPlan: session.lessonPlan,
              previousProgress,
              nextProgress: lessonProgress,
              source: 'chat',
              evidence: {
                correct: Number(verifiedStudentStateUpdate?.delta) > 0,
                answer: text,
                knowledgePoint: verifiedStudentStateUpdate?.knowledgePoint || teacherBrief.focus,
                supportLevel: verifiedStudentStateUpdate?.supportLevel || 'independent',
              },
              activeIntervention: interventionTransition.activeIntervention,
            });
          }
          const previousStepIndex = Number(previousProgress?.currentStep) || 0;
          const previousStepPhase = session.lessonPlan?.steps?.[previousStepIndex]?.phase;
          if (!teacherContinuation && !internalCommand && !isReviewResponse
            && previousStepPhase === 'check'
            && nextStudentTask?.kind === 'none'
            && Number(lessonProgress?.currentStep) === previousStepIndex) {
            teacherContinuation = planTeacherContinuation({
              lessonPlan: session.lessonPlan,
              previousProgress,
              nextProgress: lessonProgress,
              source: 'chat',
              evidence: {
                requiresRecheck: true,
                answer: text,
                knowledgePoint: verifiedStudentStateUpdate?.knowledgePoint || teacherBrief.focus,
                supportLevel: verifiedStudentStateUpdate?.supportLevel || 'independent',
              },
            });
          }
          if (session.lessonPlan && lessonProgress) {
            const lessonJustCompleted = lessonProgress.status === 'completed'
              && session.lessonProgress?.status !== 'completed';
            if (lessonJustCompleted && resumeContext?.currentLesson?.id) {
              try {
                await invoke('complete_lesson_plan', { lessonPlanId: resumeContext.currentLesson.id });
                await logLearningEvent(subjectId, 'lesson_completed', [session.lessonPlan.focus], {
                  title: session.lessonPlan.title,
                  successCriteria: session.lessonPlan.success_criteria,
                });
              } catch (error) {
                console.warn('完成课时教案失败:', error);
              }
            }
          }
          const refreshed = rebuildLongitudinalTeacherContext({
            session,
            lessonProgress,
            activeIntervention: interventionTransition.activeIntervention,
            reviewWarmup: nextReviewWarmup,
          });
          const lessonWorkspaceKey = deriveLessonWorkspaceKey({
            lessonPlan: session.lessonPlan,
            brief: teacherBrief,
          });
          const teachingBoard = applyTeachingBoardUpdate(
            session.teachingBoard,
            structured?.board_update,
            { lessonKey: lessonWorkspaceKey },
          );
          if (nextReviewWarmup?.status === 'completed') {
            const strip = document.getElementById('resumeStrip');
            if (strip) strip.hidden = true;
          }
          await persistTeachingSession(subjectId, {
            lastTeacherMove: teacherMove,
            lastTeacherQuality: { ...turnQuality, recordedAt: new Date().toISOString() },
            lessonProgress,
            brief: teacherBrief,
            learnerProfile: refreshed.learnerProfile,
            activeIntervention: interventionTransition.activeIntervention,
            reviewWarmup: nextReviewWarmup,
            pendingStudentTask: nextStudentTask,
            teachingBoard,
            ...(proposedProgrammingLab ? { programmingLab: proposedProgrammingLab, programmingLabOpen: true } : {}),
            ...(studentTurnType === 'question' && respondingStudentTask?.kind !== 'none'
              ? {
                suspendedStudentTask: respondingStudentTask,
                pendingAction: null,
              }
              : {}),
            ...(interventionTransition.resolvedIntervention
              ? { lastResolvedIntervention: interventionTransition.resolvedIntervention }
              : {}),
            ...(teacherContinuation?.kind === 'lesson_summary' ? { pendingAction: null } : {}),
            ...(nextReviewWarmup?.status === 'completed' ? { lessonStarted: true } : {}),
          });
          if (nextStudentTask?.kind === 'none' && teacherNudgeEl) {
            teacherNudgeEl.hidden = true;
          }
          await logInterventionTransition(interventionTransition);
        }
        if (!turnQuality.valid) {
          await logLearningEvent(subjectId, 'teacher_quality_warning', [teacherBrief.focus], {
            score: turnQuality.score,
            issues: turnQuality.issues,
            teacherMove: teacherMove?.move || null,
          });
        }
        renderQuickReplyButtons(quickRepliesEl, structured?.quick_replies);
        history.push({ role: 'assistant', content: teacherContentForHistory || botText });
        try {
          await invoke('save_chat_message', {
            subjectId,
            role: 'assistant',
            content: teacherContentForHistory || botText,
          });
        } catch (error) {
          console.warn('保存老师消息失败:', error);
        }
        if (teacherContinuation?.kind === 'lesson_summary' && structured) structured.actions = [];
        await handleStructuredResponse(structured, messagesEl, subjectId, verifiedStudentStateUpdate);
        renderClassroomWorkspace();
        if (proposedProgrammingLab) await renderProgrammingLab(proposedProgrammingLab);
        renderResumeSuggestion();
        queueTeacherContinuation(teacherContinuation);
        updateRightPanel(subject);
        responseCompleted = true;
      } else if (botEl.querySelector('.typing')) {
        throw new Error('模型没有返回可显示的内容');
      }
    } catch (e) {
      const reason = typeof e === 'string' ? e : (e?.message || '未知错误');
      botEl.innerHTML = `<span class="response-error"><strong>这次没有收到老师的回复</strong><span>${escapeHtml(reason)}</span><button type="button" class="retry-response">重新发送</button></span>`;
      botEl.querySelector('.retry-response')?.addEventListener('click', () => void send(text, {
        hideStudentMessage,
        internalCommand,
        continuationKind,
        exerciseTarget,
        reuseUserMessage: !internalCommand,
        sourceTaskKey,
        studentAction,
      }));
    } finally {
      statusTimers.forEach(clearTimeout);
      if (exerciseTarget) setInlineCodeExerciseState(exerciseTarget, responseCompleted ? 'reviewed' : 'error');
      sendBtn.disabled = false;
      inputEl.disabled = false;
      if (composerHintEl) composerHintEl.textContent = '把你的思路写出来，老师会先判断卡点';
      if (!responseCompleted) {
        renderClassroomWorkspace({ preserveAnswer: true });
      }
      const currentTaskView = deriveClassroomTaskWorkspace(
        state.teachingSessions[subjectId]?.pendingStudentTask,
        { pendingAction: state.teachingSessions[subjectId]?.pendingAction },
      );
      if (currentTaskView.visible && !taskAnswerEl.disabled) {
        if (taskWorkspaceEl?.dataset.editorType === 'code' && taskCodeEditor) taskCodeEditor.focus();
        else taskAnswerEl.focus({ preventScroll: true });
      }
      else inputEl.focus();
      scheduleProactiveNudge();
    }
  }

  submitCodeExerciseToTeacher = (draft, exerciseTarget) => {
    if (!messagesEl.isConnected || sendBtn.disabled) {
      showToast('老师正在处理上一条消息，请稍后再提交', 'warn');
      return false;
    }
    void send(draft, { hideStudentMessage: true, exerciseTarget });
    return true;
  };

  function scheduleProactiveNudge(delay = 90000) {
    if (!teacherNudgeEl || localStorage.getItem('warmclassroom.teacher.proactive') === 'off') return;
    if (proactiveTimer) clearTimeout(proactiveTimer);
    const getNudgeKey = () => {
      const session = state.teachingSessions[subjectId] || {};
      const task = session.pendingStudentTask;
      if (!task || task.kind === 'none') return '';
      return task.key || `${task.kind}:${task.prompt || ''}`;
    };
    const canNudge = () => teacherNudgeEl.isConnected
      && !document.hidden
      && !inputEl.value.trim()
      && !(taskAnswerEl?.value || '').trim()
      && !sendBtn.disabled
      && !state.teachingSessions[subjectId]?.pendingAction;
    const showDelay = Math.max(0, delay - 15000);
    proactiveTimer = setTimeout(() => {
      const nudgeKey = getNudgeKey();
      if (!canNudge() || !nudgeKey) return;
      if (state.teachingSessions[subjectId]?.lastProactiveNudgeKey === nudgeKey) return;
      teacherNudgeEl.hidden = false;
    }, showDelay);
  }

  const submitCurrentTask = () => {
    const answer = String(taskAnswerEl?.value || '').trim();
    if (!answer) {
      if (taskStatusEl) taskStatusEl.textContent = '请先写下你的答案';
      taskAnswerEl?.focus();
      return;
    }
    const sourceTaskKey = taskWorkspaceEl?.dataset.taskKey || '';
    if (taskDraftSaveTimer) {
      clearTimeout(taskDraftSaveTimer);
      saveCurrentTaskDraft();
    }
    void send(answer, { sourceTaskKey, studentAction: 'answer' });
  };

  taskSubmitEl?.addEventListener('click', submitCurrentTask);
  taskPanelToggleEl?.addEventListener('click', () => {
    const willExpand = taskWorkspaceEl?.classList.contains('is-collapsed');
    setTaskPanelCollapsed(!willExpand, { focusEditor: willExpand });
  });
  const resizeTaskPanel = delta => {
    if (!taskWorkspaceEl || taskWorkspaceEl.dataset.editorType !== 'code') return;
    const current = taskWorkspaceEl.getBoundingClientRect().height;
    const minimum = 280;
    const maximum = Math.max(minimum, Math.min(620, (taskWorkspaceEl.parentElement?.clientHeight || window.innerHeight) - 110));
    taskWorkspaceEl.style.setProperty('--task-panel-height', `${Math.min(maximum, Math.max(minimum, current + delta))}px`);
  };
  taskResizeHandleEl?.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    resizeTaskPanel(event.key === 'ArrowUp' ? 24 : -24);
  });
  taskResizeHandleEl?.addEventListener('pointerdown', event => {
    if (event.button !== 0 || taskWorkspaceEl?.dataset.editorType !== 'code') return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = taskWorkspaceEl.getBoundingClientRect().height;
    const move = moveEvent => resizeTaskPanel(startHeight + startY - moveEvent.clientY - taskWorkspaceEl.getBoundingClientRect().height);
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop, { once: true });
  });
  taskAnswerEl?.addEventListener('input', () => {
    draftObservationRequestId += 1;
    hideDraftCoach();
    if (taskStatusEl) taskStatusEl.textContent = '草稿保存中…';
    scheduleTaskDraftSave();
    scheduleDraftObservation();
  });
  taskAnswerEl?.addEventListener('blur', () => {
    if (taskDraftSaveTimer) clearTimeout(taskDraftSaveTimer);
    saveCurrentTaskDraft();
  });
  taskAnswerEl?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const taskView = deriveClassroomTaskWorkspace(state.teachingSessions[subjectId]?.pendingStudentTask, {
      pendingAction: state.teachingSessions[subjectId]?.pendingAction,
    });
    const shouldSubmit = event.ctrlKey || (taskView.answerMode === 'short' && !event.shiftKey);
    if (!shouldSubmit) return;
    event.preventDefault();
    submitCurrentTask();
  });
  taskObserverToggleEl?.addEventListener('change', () => {
    draftObservationEnabled = taskObserverToggleEl.checked;
    writeLocalValue(DRAFT_OBSERVER_PREFERENCE_KEY, draftObservationEnabled ? 'on' : 'off');
    clearDraftObservationTimer();
    draftObservationRequestId += 1;
    hideDraftCoach();
    if (taskStatusEl) {
      taskStatusEl.textContent = draftObservationEnabled
        ? '草稿自动保存 · 老师观察中'
        : '草稿自动保存 · 老师观察已暂停';
    }
    if (draftObservationEnabled) scheduleDraftObservation();
  });
  draftCoachDismissEl?.addEventListener('click', hideDraftCoach);
  taskHintEl?.addEventListener('click', () => {
    const taskView = deriveClassroomTaskWorkspace(state.teachingSessions[subjectId]?.pendingStudentTask, {
      pendingAction: state.teachingSessions[subjectId]?.pendingAction,
    });
    if (taskWorkspaceEl?.dataset.editorType === 'code' && taskView.hints?.length) {
      taskHintIndex = Math.min(taskHintIndex, taskView.hints.length - 1);
      taskCodeEditorEl.dataset.ghostHint = taskView.hints[taskHintIndex];
      taskCodeEditorEl.classList.add('show-hint');
      taskHintIndex = Math.min(taskView.hints.length - 1, taskHintIndex + 1);
      if (taskStatusEl) taskStatusEl.textContent = '老师提示已显示在编辑器中 · 只给下一步，不代写答案';
      taskCodeEditor?.focus();
      return;
    }
    const sourceTaskKey = taskWorkspaceEl?.dataset.taskKey || '';
    void send('我卡在当前任务上了，请只给我一个方向性提示，不要直接公布答案。', {
      hideStudentMessage: true,
      internalCommand: true,
      sourceTaskKey,
      studentAction: 'support',
    });
  });
  taskAlternateEl?.addEventListener('click', () => {
    const sourceTaskKey = taskWorkspaceEl?.dataset.taskKey || '';
    void send('当前讲法我还不清楚，请换一种表示方式讲同一个点，并保留当前任务。', {
      hideStudentMessage: true,
      internalCommand: true,
      sourceTaskKey,
      studentAction: 'support',
    });
  });

  quickRepliesEl?.addEventListener('click', event => {
    const button = event.target.closest('[data-reply]');
    if (!button || sendBtn.disabled) return;
    const sourceTaskKey = taskWorkspaceEl?.dataset.taskKey || '';
    const reply = button.dataset.reply || '';
    if (reply === '继续' && queuedTeacherContinuation) {
      void flushTeacherContinuation({ studentInitiated: true });
      return;
    }
    if (reply === '先停一下' && queuedTeacherContinuation) {
      const continuation = queuedTeacherContinuation;
      queuedTeacherContinuation = null;
      void persistTeachingSession(subjectId, { pendingTeacherContinuation: continuation });
      renderQuickReplyButtons(quickRepliesEl, []);
      showToast('已停在这里，下次可以继续', 'success');
      return;
    }
    if (reply === '稍后练习' && sourceTaskKey) {
      const session = state.teachingSessions[subjectId] || {};
      const task = session.pendingStudentTask;
      if (isCurrentTaskSubmission(task, sourceTaskKey)) {
        void persistTeachingSession(subjectId, {
          pendingStudentTask: { kind: 'none' },
          deferredRecheck: { task, deferredAt: new Date().toISOString() },
        }).then(() => {
          renderClassroomWorkspace();
          if (teacherNudgeEl) {
            teacherNudgeEl.hidden = false;
            const title = teacherNudgeEl.querySelector('strong');
            const resume = teacherNudgeEl.querySelector('[data-nudge="continue"]');
            if (title) title.textContent = '这道迁移练习已保存';
            if (resume) resume.textContent = '继续练习';
          }
          showToast('已保存，稍后可以继续这道练习', 'success');
        });
      }
      return;
    }
    void send(reply, sourceTaskKey
      ? { sourceTaskKey, studentAction: 'answer' }
      : {});
  });

  document.getElementById('openProgrammingLab')?.addEventListener('click', () => void renderProgrammingLab());
  document.getElementById('programmingLabClose')?.addEventListener('click', closeProgrammingLab);
  document.getElementById('programmingLabReset')?.addEventListener('click', () => {
    const lab = state.teachingSessions[subjectId]?.programmingLab;
    if (!lab || !programmingLabEditor) return;
    programmingLabEditor.setValue(lab.initialCode);
    showToast('已恢复实验初始代码', 'success');
  });
  programmingLabRunEl?.addEventListener('click', async () => {
    const lab = state.teachingSessions[subjectId]?.programmingLab;
    if (!lab || !programmingLabEditor) return;
    programmingLabRunEl.disabled = true;
    programmingLabRunEl.querySelector('span').textContent = '运行中…';
    programmingLabOutputEl.textContent = '正在调用本机 JDK 编译并运行…';
    try {
      const code = programmingLabEditor.getValue();
      const result = await invoke('run_java_code', { code });
      const updated = updateLabAfterRun({ ...lab, code }, result);
      await persistTeachingSession(subjectId, { programmingLab: updated });
      programmingLabOutputEl.textContent = [updated.runResult.stdout, updated.runResult.stderr]
        .filter(Boolean).join('\n') || '程序没有输出';
      const meta = document.getElementById('programmingLabRunMeta');
      if (meta) meta.textContent = `${updated.runResult.success ? '运行成功' : '运行失败'} · ${updated.runResult.executionTimeMs} ms`;
      programmingLabOutputEl.dataset.status = updated.runResult.success ? 'success' : 'error';
      if (programmingLabSubmitEl) programmingLabSubmitEl.hidden = !(updated.taskKey && updated.runResult);
      await logLearningEvent(subjectId, 'programming_lab_run', [teacherBrief.focus], {
        labId: updated.id, success: updated.runResult.success, errorType: updated.runResult.errorType,
        executionTimeMs: updated.runResult.executionTimeMs, taskKey: updated.taskKey || null,
      });
    } catch (error) {
      programmingLabOutputEl.textContent = String(error || 'Java 运行失败');
      programmingLabOutputEl.dataset.status = 'error';
    } finally {
      programmingLabRunEl.disabled = false;
      programmingLabRunEl.querySelector('span').textContent = '运行';
    }
  });
  programmingLabSubmitEl?.addEventListener('click', () => {
    const lab = state.teachingSessions[subjectId]?.programmingLab;
    const submission = buildLabSubmission(lab);
    const currentTask = state.teachingSessions[subjectId]?.pendingStudentTask;
    if (!submission || currentTask?.key !== submission.taskKey) {
      showToast('当前实验没有绑定可提交的课堂任务', 'error');
      return;
    }
    void send(`我完成了 Java 动手实验。\n\n\`\`\`java\n${submission.code}\n\`\`\`\n\n真实运行结果：\n\`\`\`text\n${submission.stdout || submission.stderr || '无输出'}\n\`\`\``, {
      hideStudentMessage: true,
      sourceTaskKey: submission.taskKey,
      studentAction: 'answer',
    });
  });
  if (programmingLabResizerEl) {
    programmingLabResizerEl.addEventListener('pointerdown', event => {
      programmingLabResizerEl.setPointerCapture(event.pointerId);
      const stacked = matchMedia('(max-width: 1450px)').matches;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = programmingLabEl.getBoundingClientRect().width;
      const startHeight = programmingLabEl.getBoundingClientRect().height;
      const move = moveEvent => {
        if (stacked) {
          const height = Math.max(300, Math.min(window.innerHeight * 0.7, startHeight + startY - moveEvent.clientY));
          programmingLabEl.style.height = `${height}px`;
          localStorage.setItem('warmclassroom.programmingLabHeight', String(height));
          return;
        }
        const width = Math.max(320, Math.min(720, startWidth + startX - moveEvent.clientX));
        programmingLabEl.style.width = `${width}px`;
        localStorage.setItem('warmclassroom.programmingLabWidth', String(width));
      };
      const end = () => {
        programmingLabResizerEl.removeEventListener('pointermove', move);
        programmingLabResizerEl.removeEventListener('pointerup', end);
      };
      programmingLabResizerEl.addEventListener('pointermove', move);
      programmingLabResizerEl.addEventListener('pointerup', end);
    });
    programmingLabResizerEl.addEventListener('keydown', event => {
      const stacked = matchMedia('(max-width: 1450px)').matches;
      const allowed = stacked ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      if (!allowed.includes(event.key)) return;
      event.preventDefault();
      if (stacked) {
        const height = programmingLabEl.getBoundingClientRect().height + (event.key === 'ArrowUp' ? 24 : -24);
        programmingLabEl.style.height = `${Math.max(300, Math.min(window.innerHeight * 0.7, height))}px`;
        return;
      }
      const width = programmingLabEl.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 24 : -24);
      programmingLabEl.style.width = `${Math.max(320, Math.min(720, width))}px`;
    });
  }

  document.getElementById('resumeReview')?.addEventListener('click', () => {
    const weakPoint = resumeContext?.brief?.focus || teacherBrief.focus;
    void send(`老师，先围绕“${weakPoint}”给我一道两分钟复习题。只出题，不要先给答案。`, {
      hideStudentMessage: true,
      internalCommand: true,
    });
  });
  const startNextLesson = async button => {
    const session = state.teachingSessions[subjectId] || {};
    const nextLessonFocus = String(session.lastLessonSummary?.next_lesson_focus || '').trim();
    button.disabled = true;
    button.textContent = '正在准备…';
    try {
      if (resumeContext?.currentLesson?.id) {
        await invoke('complete_lesson_plan', { lessonPlanId: resumeContext.currentLesson.id }).catch(() => null);
      }
      const ensuredLesson = await ensureLessonPlan({
        subjectId,
        subjectName,
        assessed: true,
        currentLesson: null,
        knowledgePoints: resumeContext?.knowledgePoints || [],
        recentEvents: resumeContext?.recentEvents || [],
        mistakes: resumeContext?.mistakes || [],
        lastLessonSummary: session.lastLessonSummary || null,
        teachingPreferences: session.teachingPreferences,
        nextLessonFocus,
      });
      const lessonProgress = {
        currentStep: 0,
        attempts: 0,
        status: 'active',
        gateVersion: 1,
        legacyThroughStep: -1,
        evidenceLedger: { records: [] },
      };
      await persistTeachingSession(subjectId, {
        lessonPlan: ensuredLesson.plan,
        lessonProgress,
        lessonStarted: false,
        skipOpeningWarmup: true,
        reviewWarmup: null,
        pendingStudentTask: { kind: 'none' },
        suspendedStudentTask: null,
        deferredRecheck: null,
        pendingAction: null,
        activeIntervention: null,
        teachingBoard: null,
        programmingLab: null,
        programmingLabOpen: false,
        lastTeacherMove: null,
        lastTeacherContinuationKey: null,
        lastTeacherContinuationKind: null,
        lastProactiveNudgeKey: null,
      });
      showToast(`已准备下一节：${ensuredLesson.plan?.title || nextLessonFocus || '新课'}`, 'success');
      const chatTab = state.tabs.find(tab => tab.id === `chat-${subjectId}`);
      if (chatTab) renderTabContent(chatTab);
    } catch (error) {
      console.error('开始下一节失败:', error);
      showToast('下一节准备失败，请稍后重试', 'error');
      button.disabled = false;
      button.textContent = '开始下一节';
    }
  };
  document.getElementById('resumeContinue')?.addEventListener('click', event => {
    if (event.currentTarget.dataset.action === 'next-lesson') {
      void startNextLesson(event.currentTarget);
      return;
    }
    void send(`老师，请按当前教案继续“${resumeContext?.currentLesson?.title || teacherBrief.focus}”。先检查当前教案阶段：如果讲解或示范尚未完成，就先讲清原理并展示完整例子；只有进入练习或检查阶段时才布置一个明确任务。不要重复我刚刚已经通过的练习。`, {
      hideStudentMessage: true,
      internalCommand: true,
    });
  });
  teacherNudgeEl?.addEventListener('click', event => {
    const action = event.target.closest('[data-nudge]')?.dataset.nudge;
    if (!action) return;
    teacherNudgeEl.hidden = true;
    if (action === 'continue') {
      const session = state.teachingSessions[subjectId] || {};
      if (session.suspendedStudentTask?.kind && session.suspendedStudentTask.kind !== 'none') {
        void persistTeachingSession(subjectId, {
          pendingStudentTask: session.suspendedStudentTask,
          suspendedStudentTask: null,
        }).then(() => renderClassroomWorkspace());
        return;
      }
      if (session.deferredRecheck?.task) {
        void persistTeachingSession(subjectId, {
          pendingStudentTask: session.deferredRecheck.task,
          deferredRecheck: null,
        }).then(() => renderClassroomWorkspace());
        return;
      }
      const task = session.pendingStudentTask;
      const nudgeKey = task?.key || '';
      if (nudgeKey) void persistTeachingSession(subjectId, { lastProactiveNudgeKey: nudgeKey });
      if (!task || task.kind === 'none') return;
      renderClassroomWorkspace({ preserveAnswer: true });
      setTaskPanelCollapsed(false, { focusEditor: true });
      if (composerHintEl) composerHintEl.textContent = '继续完成当前任务，草稿已经保留';
    } else {
      if (composerHintEl) composerHintEl.textContent = '慢慢想，老师稍后再提醒你';
      scheduleProactiveNudge(180000);
    }
  });

  sendBtn.addEventListener('click', () => void send());
  document.getElementById('lessonSummary')?.addEventListener('click', () => {
    void send('老师，请根据本节课的真实对话、练习和小测表现做课堂小结：只记录有证据的掌握、待巩固点、复习任务和下节重点。', {
      hideStudentMessage: true,
      internalCommand: true,
    });
  });
  document.getElementById('lessonAssessment')?.addEventListener('click', () => {
    void send('老师，请根据本节目标开始章节评估。一次只出一道题，覆盖理解、应用和易错点；先不要公布答案，根据我的回答继续下一题，最后给出有证据的评估总结。', {
      hideStudentMessage: true,
      internalCommand: true,
    });
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  renderExistingHistory();
  const loadedSession = state.teachingSessions[subjectId] || {};
  const legacyRepairTask = loadedSession.pendingStudentTask;
  const legacyRepairContinuation = legacyRepairTask?.repairContext
    ? planRepairContinuation({
      task: legacyRepairTask,
      verification: {
        trusted: true,
        verdict: 'incorrect',
        firstErrorExcerpt: legacyRepairTask.repairContext.firstErrorExcerpt || 'legacy-repair',
      },
    })
    : null;
  const staleRecheckContinuation = legacyRepairTask?.kind !== 'none'
    && /同构|变式|独立完成/u.test(String(legacyRepairTask?.prompt || ''))
    && !isConcreteStudentTaskPrompt(legacyRepairTask?.prompt)
    ? {
      kind: 'instructional_recheck_retry',
      key: `restore-missing-recheck:${legacyRepairTask.key || legacyRepairTask.prompt}`.slice(0, 220),
      command: `当前对话中上一道迁移练习只保存了动作标签，没有实际题面。请结合本对话刚讲过的内容，围绕“${teacherBrief.focus || '当前知识点'}”立即补充一道具体的新同构题。student_task.prompt 必须写出完整题面，不能写“完成这道新同构题”等占位语；同时提供明确 expected_response 和隐藏 assessment。不要重讲原题，不要公布新题答案。`,
    }
    : null;
  const currentLessonStep = loadedSession.lessonPlan?.steps?.[loadedSession.lessonProgress?.currentStep];
  const summaryStepIndex = loadedSession.lessonPlan?.steps?.findIndex(step => step.phase === 'summary') ?? -1;
  const independentSuccesses = (loadedSession.teachingMemory?.effectiveStrategies || [])
    .filter(item => item.strategy === 'independent_recheck')
    .reduce((sum, item) => sum + (Number(item.independentSuccesses) || 0), 0);
  const shouldCloseLegacyRecheckChain = currentLessonStep?.phase === 'check'
    && loadedSession.lastTeacherMove?.teachingStrategy === 'independent_recheck'
    && independentSuccesses >= 2
    && summaryStepIndex >= 0;
  const shouldDiscardChainedRecheck = currentLessonStep?.phase === 'check'
    && loadedSession.pendingStudentTask?.cadenceRole === 'transfer_check'
    && ['instructional_recheck', 'instructional_recheck_retry'].includes(
      loadedSession.lastTeacherContinuationKind,
    );
  const recoveredProgress = shouldCloseLegacyRecheckChain
    ? { ...loadedSession.lessonProgress, currentStep: summaryStepIndex, attempts: 0, status: 'active' }
    : null;
  const cadenceRecoveryContinuation = recoveredProgress
    ? planTeacherContinuation({
      lessonPlan: loadedSession.lessonPlan,
      previousProgress: loadedSession.lessonProgress,
      nextProgress: recoveredProgress,
      source: 'chat',
      evidence: {
        correct: true,
        knowledgePoint: loadedSession.lessonPlan.focus,
        answer: loadedSession.teachingMemory?.effectiveStrategies?.[0]?.lastEvidence || '已有两次独立正确证据',
        supportLevel: 'independent',
      },
    })
    : null;
  const restoredContinuation = cadenceRecoveryContinuation
    || legacyRepairContinuation
    || staleRecheckContinuation;
  if (restoredContinuation) {
    await persistTeachingSession(subjectId, {
      pendingStudentTask: { kind: 'none' },
      pendingAction: null,
      ...(recoveredProgress ? { lessonProgress: recoveredProgress } : {}),
    });
  } else if (shouldDiscardChainedRecheck) {
    await persistTeachingSession(subjectId, {
      pendingStudentTask: { kind: 'none' },
      pendingAction: null,
      lastTeacherContinuationKind: null,
    });
  } else if (loadedSession.pendingAction && loadedSession.pendingStudentTask?.kind !== 'none') {
    await persistTeachingSession(subjectId, { pendingAction: null });
  }
  const pendingAction = state.teachingSessions[subjectId]?.pendingAction;
  if (pendingAction?.type === 'open_practice_panel' && pendingAction.practice) {
    await practicePanel.open(pendingAction.practice);
  } else if (pendingAction?.type === 'show_quiz' && pendingAction.quiz) {
    quizPanel.open(pendingAction.quiz, subjectId);
  }
  renderClassroomWorkspace();
  const savedLabWidth = Number(localStorage.getItem('warmclassroom.programmingLabWidth'));
  if (programmingLabEl && savedLabWidth) programmingLabEl.style.width = `${Math.max(320, Math.min(720, savedLabWidth))}px`;
  const savedLabHeight = Number(localStorage.getItem('warmclassroom.programmingLabHeight'));
  if (programmingLabEl && savedLabHeight) programmingLabEl.style.height = `${Math.max(300, Math.min(window.innerHeight * 0.7, savedLabHeight))}px`;
  if (loadedSession.programmingLabOpen && loadedSession.programmingLab) {
    await renderProgrammingLab(loadedSession.programmingLab);
  }
  if (state.teachingSessions[subjectId]?.deferredRecheck?.task && teacherNudgeEl) {
    teacherNudgeEl.hidden = false;
    const title = teacherNudgeEl.querySelector('strong');
    const resume = teacherNudgeEl.querySelector('[data-nudge="continue"]');
    if (title) title.textContent = '上次保存了一道迁移练习';
    if (resume) resume.textContent = '继续练习';
  }
  const suspendedTaskKind = state.teachingSessions[subjectId]?.suspendedStudentTask?.kind;
  if (suspendedTaskKind && suspendedTaskKind !== 'none' && teacherNudgeEl) {
    teacherNudgeEl.hidden = false;
    const title = teacherNudgeEl.querySelector('strong');
    const resume = teacherNudgeEl.querySelector('[data-nudge="continue"]');
    if (title) title.textContent = '刚才的练习已暂停';
    if (resume) resume.textContent = '继续练习';
  }
  inputEl.disabled = false;
  sendBtn.disabled = false;
  queueTeacherContinuation(restoredContinuation);
  const initialTaskView = deriveClassroomTaskWorkspace(
    state.teachingSessions[subjectId]?.pendingStudentTask,
    { pendingAction: state.teachingSessions[subjectId]?.pendingAction },
  );
  if (initialTaskView.visible) taskAnswerEl.focus({ preventScroll: true });
  else inputEl.focus();
  const activeSession = state.teachingSessions[subjectId] || {};
  if (subject?.assessed && activeSession.lessonPlan && !activeSession.lessonStarted && !activeSession.pendingAction) {
    const warmupStatus = activeSession.reviewWarmup?.status;
    if (warmupStatus === 'scheduled' && resumeContext?.openingWarmupContinuation) {
      if (activeSession.lastTeacherContinuationKey === resumeContext.openingWarmupContinuation.key) {
        await persistTeachingSession(subjectId, {
          lastTeacherContinuationKey: null,
          lastTeacherContinuationKind: null,
        });
      }
      queueTeacherContinuation(resumeContext.openingWarmupContinuation);
    } else if (['awaiting_response', 'remediate'].includes(warmupStatus)) {
      scheduleProactiveNudge();
    } else {
      await persistTeachingSession(subjectId, { lessonStarted: true, skipOpeningWarmup: false });
      void send(
        '请按当前教案主动开始本节课。若当前是讲解步骤，请完整完成“概念模型、最小例子、关键对比和小结”，本轮不要出题；只有进入练习或检查步骤后才生成一个任务。不要等待学生先提问。',
        { hideStudentMessage: true, internalCommand: true },
      );
    }
  } else {
    scheduleProactiveNudge();
  }
}

// ============ 其他视图 ============

function renderModuleEmptyView(container, { icon, title, description }) {
  container.innerHTML = `
    <div class="placeholder module-empty" role="status">
      <div class="ph-icon" aria-hidden="true">${icon}</div>
      <h2>${title}</h2>
      <p>${description}</p>
    </div>
  `;
}

async function renderNoteView(container) {
  const subjectId = state.currentSubject;
  if (!subjectId) {
    renderModuleEmptyView(container, { icon: ICONS.notes, title: '还没有笔记', description: '请先选择一个科目。' });
    return;
  }

  container.innerHTML = `
    <div class="notes-view">
      <div class="notes-toolbar">
        <button class="btn-primary btn-new-note" type="button"><span class="inline-icon" aria-hidden="true">${ICONS.notes}</span>新建笔记</button>
      </div>
      <div class="notes-list" id="notesList"></div>
      <div class="notes-editor-area" id="notesEditorArea" style="display:none">
        <input class="notes-title-input" id="noteTitle" type="text" placeholder="笔记标题" />
        <textarea class="notes-content" id="noteContent" placeholder="写点什么..."></textarea>
        <div class="notes-actions">
          <button class="btn-secondary" id="noteSave" type="button">保存</button>
          <button class="btn-secondary note-delete" id="noteDelete" type="button">删除</button>
        </div>
      </div>
    </div>
  `;

  let currentNoteId = null;
  const notesList = container.querySelector('#notesList');
  const editorArea = container.querySelector('#notesEditorArea');
  const titleInput = container.querySelector('#noteTitle');
  const contentInput = container.querySelector('#noteContent');

  async function loadNotes() {
    try {
      const notes = await invoke('get_notes', { subjectId });
      if (notes.length === 0) {
        notesList.innerHTML = '<div class="notes-empty">暂无笔记，点击上方按钮新建</div>';
      } else {
        notesList.innerHTML = notes.map(n => `
          <div class="note-card" data-id="${n.id}">
            <div class="note-card-title">${escapeHtml(n.title)}</div>
            <div class="note-card-preview">${escapeHtml((n.content || '').substring(0, 80))}</div>
            <div class="note-card-time">${n.updated_at ? new Date(n.updated_at).toLocaleString('zh-CN') : ''}</div>
          </div>
        `).join('');
        notesList.querySelectorAll('.note-card').forEach(card => {
          card.addEventListener('click', async () => {
            const note = notes.find(n => n.id === parseInt(card.dataset.id));
            if (note) {
              currentNoteId = note.id;
              titleInput.value = note.title;
              contentInput.value = note.content || '';
              editorArea.style.display = 'flex';
            }
          });
        });
        if (state.selectedNoteId) {
          const selected = notes.find(note => note.id === state.selectedNoteId);
          if (selected) {
            currentNoteId = selected.id;
            titleInput.value = selected.title;
            contentInput.value = selected.content || '';
            editorArea.style.display = 'flex';
          }
          state.selectedNoteId = null;
        }
        void persistTeachingSession(subjectId, { pendingAction: null });
      }
    } catch (e) {
      notesList.innerHTML = `<div class="notes-empty">加载失败：${e}</div>`;
    }
  }

  container.querySelector('.btn-new-note').addEventListener('click', () => {
    currentNoteId = null;
    titleInput.value = '';
    contentInput.value = '';
    editorArea.style.display = 'flex';
    titleInput.focus();
  });

  container.querySelector('#noteSave').addEventListener('click', async () => {
    const title = titleInput.value.trim() || '无标题笔记';
    const content = contentInput.value;
    try {
      currentNoteId = await invoke('save_note', { subjectId, title, content, noteId: currentNoteId });
      await loadNotes();
      editorArea.style.display = 'none';
      updateSidebarForView('notes');
      showToast('笔记已保存', 'success');
    } catch (e) { showToast('保存失败：' + e, 'error'); }
  });

  container.querySelector('#noteDelete').addEventListener('click', async () => {
    if (!currentNoteId) { editorArea.style.display = 'none'; return; }
    if (!confirm('确定删除这篇笔记？')) return;
    try {
      await invoke('delete_note', { noteId: currentNoteId });
      await loadNotes();
      editorArea.style.display = 'none';
      updateSidebarForView('notes');
      showToast('笔记已删除', 'success');
    } catch (e) { showToast('删除失败：' + e, 'error'); }
  });

  await loadNotes();
}

function openTeacherWithDraft(subjectId, draft) {
  const subject = state.subjects.find(item => item.id === subjectId);
  if (!subject) return;
  if (!subject.assessed) {
    showToast('先完成该科目的摸底，老师才能针对学情辅导', 'warn');
    selectSubject(subjectId);
    return;
  }
  switchView('chat');
  state.currentSubject = subjectId;
  openTab(`chat-${subjectId}`, subject.name, 'chat');
  const input = document.getElementById('input');
  if (input) {
    input.value = draft;
    input.focus();
  }
}

async function renderHomeworkView(container) {
  const subjectId = state.currentSubject;
  if (!subjectId) {
    renderModuleEmptyView(container, { icon: ICONS.homework, title: '还没有作业', description: '请先选择一个科目。' });
    return;
  }

  try {
    const homeworkList = await invoke('get_homework', { subjectId });
    const statusLabels = { pending: '待完成', 'in-progress': '进行中', completed: '已提交', graded: '已批改' };

    container.innerHTML = `
      <div class="homework-view">
        <div class="module-toolbar">
          <div><h2>我的作业</h2><p>${homeworkList.length} 项学习任务</p></div>
          <button class="btn-primary" id="homeworkCreateToggle" type="button"><span class="inline-icon" aria-hidden="true">${ICONS.homework}</span>新建练习</button>
        </div>
        <form class="homework-create" id="homeworkCreate" hidden>
          <label>标题<input id="homeworkTitle" required maxlength="80" placeholder="例如：二次函数巩固练习"></label>
          <label>要求<textarea id="homeworkDescription" required rows="3" placeholder="写清要完成的问题或练习要求"></textarea></label>
          <label>截止日期<input id="homeworkDueDate" type="date"></label>
          <div class="form-actions"><button class="btn-secondary" id="homeworkCancel" type="button">取消</button><button class="btn-primary" type="submit">保存练习</button></div>
        </form>
        <div class="homework-list">
          ${homeworkList.length ? homeworkList.map(hw => `
            <div class="homework-card" data-id="${hw.id}">
              <div class="hw-header">
                <span class="hw-title">${escapeHtml(hw.title)}</span>
                <span class="hw-status" data-status="${escapeHtml(hw.status)}">${statusLabels[hw.status] || hw.status}</span>
              </div>
              <div class="hw-desc">${escapeHtml(hw.description || '')}</div>
              ${hw.due_date ? `<div class="hw-due"><span class="inline-icon" aria-hidden="true">${ICONS.calendar}</span>${escapeHtml(hw.due_date)}</div>` : ''}
              <label class="hw-answer-label">我的作答
                <textarea class="hw-answer" rows="3" ${hw.status === 'graded' ? 'disabled' : ''} placeholder="写下解题过程、答案或学习成果">${escapeHtml(hw.student_answer || '')}</textarea>
              </label>
              ${hw.grade ? `<div class="hw-grade">批改结果：${escapeHtml(hw.grade)}</div>` : ''}
              <div class="hw-footer"><span class="hw-time">${hw.created_at ? new Date(hw.created_at).toLocaleString('zh-CN') : ''}</span><div class="hw-actions"><button class="btn-secondary hw-ask" type="button">交给老师辅导</button>${hw.status === 'completed' ? '<button class="btn-secondary hw-grade-request" type="button">请求批改</button>' : ''}<button class="btn-primary hw-submit" type="button" ${hw.status === 'graded' ? 'disabled' : ''}>${hw.status === 'completed' ? '更新提交' : '提交作业'}</button></div></div>
            </div>
          `).join('') : `<div class="module-empty-inline">${ICONS.homework}<strong>还没有作业</strong><p>新建一项练习，或让 AI 老师在课堂中为你安排任务。</p></div>`}
        </div>
      </div>
    `;

    const form = container.querySelector('#homeworkCreate');
    container.querySelector('#homeworkCreateToggle').addEventListener('click', () => {
      form.hidden = false;
      container.querySelector('#homeworkTitle').focus();
    });
    container.querySelector('#homeworkCancel').addEventListener('click', () => { form.hidden = true; form.reset(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const title = container.querySelector('#homeworkTitle').value.trim();
      const description = container.querySelector('#homeworkDescription').value.trim();
      const dueDate = container.querySelector('#homeworkDueDate').value || null;
      if (!title || !description) return showToast('请填写作业标题和要求', 'warn');
      try {
        await invoke('save_homework', { subjectId, title, description, dueDate });
        showToast('练习已创建', 'success');
        updateSidebarForView('homework');
        await renderHomeworkView(container);
      } catch (error) { showToast(`创建失败：${error}`, 'error'); }
    });

    container.querySelectorAll('.homework-card').forEach(card => {
      const homework = homeworkList.find(item => item.id === Number(card.dataset.id));
      const answer = card.querySelector('.hw-answer');
      card.querySelector('.hw-submit').addEventListener('click', async () => {
        const studentAnswer = answer.value.trim();
        if (!studentAnswer) return showToast('请先写下你的作答', 'warn');
        try {
          await invoke('update_homework_status', { homeworkId: homework.id, status: 'completed', studentAnswer, grade: null });
          await logLearningEvent(subjectId, 'homework_submit', [], { homeworkId: homework.id, title: homework.title });
          showToast('作业已提交', 'success');
          updateSidebarForView('homework');
          await renderHomeworkView(container);
        } catch (error) { showToast(`提交失败：${error}`, 'error'); }
      });
      card.querySelector('.hw-ask').addEventListener('click', () => {
        const studentAnswer = answer.value.trim();
        if (!studentAnswer) return showToast('先写下你的尝试，老师才能针对过程辅导', 'warn');
        openTeacherWithDraft(subjectId, `老师，请辅导我完成这项作业。\n题目：${homework.title}\n要求：${homework.description}\n我的尝试：${studentAnswer}\n请先分析我做对的部分和具体卡点，不要直接给完整答案。`);
      });
      card.querySelector('.hw-grade-request')?.addEventListener('click', async () => {
        const studentAnswer = answer.value.trim();
        if (!studentAnswer) return showToast('找不到已提交的作答', 'warn');
        await persistTeachingSession(subjectId, { pendingHomework: { id: homework.id, title: homework.title } });
        openTeacherWithDraft(subjectId, `老师，我明确请求批改这项作业。\n作业 ID：${homework.id}\n题目：${homework.title}\n要求：${homework.description}\n我的答案：${studentAnswer}\n请核对要求，给出具体反馈，并在结构化输出中返回对应的 homework_update。`);
      });
    });
  } catch (e) {
    renderModuleEmptyView(container, { icon: ICONS.homework, title: '加载失败', description: String(e) });
  }
}

async function renderReviewView(container) {
  const subjectId = state.currentSubject;
  if (!subjectId) {
    renderModuleEmptyView(container, { icon: ICONS.review, title: '还没有复习内容', description: '请先选择一个科目。' });
    return;
  }

  try {
    const [mistakes, knowledgePoints, events, sessionJson] = await Promise.all([
      invoke('get_mistakes', { subjectId }).catch(() => []),
      invoke('get_knowledge_points', { subjectId }).catch(() => []),
      invoke('get_learning_events', { subjectId }).catch(() => []),
      invoke('get_teaching_session', { subjectId }).catch(() => null),
    ]);
    if (!state.teachingSessions[subjectId] && sessionJson) {
      try { state.teachingSessions[subjectId] = JSON.parse(sessionJson); } catch {}
    }

    const recentMistakes = (mistakes || []).slice(-20).reverse();
    const lessonSummary = state.teachingSessions[subjectId]?.lastLessonSummary || null;
    const learnerProfile = buildLearnerProfile(
      knowledgePoints,
      recentMistakes,
      events,
      lessonSummary,
      new Date(),
      state.teachingSessions[subjectId]?.teachingPreferences,
    );
    const reviewQueue = buildReviewQueue(knowledgePoints, recentMistakes, new Date(), events);

    if (reviewQueue.length === 0 && recentMistakes.length === 0 && !lessonSummary) {
      renderModuleEmptyView(container, {
        icon: ICONS.review,
        title: '还没有复习内容',
        description: '完成练习和小测后，错题和薄弱知识点会出现在这里。',
      });
      return;
    }

    container.innerHTML = `
      <div class="review-view">
        ${lessonSummary ? `
        <div class="review-section">
          <h3 class="review-section-title">上节课结论</h3>
          <div class="lesson-summary-review">
            ${lessonSummary.mastered.map(item => `<div><span>已证明</span><strong>${escapeHtml(item.knowledge_point)}</strong><small>${escapeHtml(item.evidence)}</small></div>`).join('')}
            ${lessonSummary.needs_work.map(item => `<div><span>待巩固</span><strong>${escapeHtml(item.knowledge_point)}</strong><small>${escapeHtml(item.next_action)}</small></div>`).join('')}
            ${(lessonSummary.not_yet_verified || []).map(item => `<div><span>待确认</span><strong>${escapeHtml(item.knowledge_point)}</strong><small>${escapeHtml(item.next_check)}</small></div>`).join('')}
            ${lessonSummary.review ? `<div><span>复习任务</span><strong>${escapeHtml(lessonSummary.review.focus)} · ${lessonSummary.review.interval_days === 0 ? '今天' : `${lessonSummary.review.interval_days} 天后`}</strong><small>${escapeHtml(lessonSummary.review.task)}</small></div>` : ''}
          </div>
        </div>
        ` : ''}
        ${learnerProfile.recurringPatterns.length > 0 ? `
        <div class="review-section">
          <h3 class="review-section-title">老师持续关注</h3>
          <div class="review-patterns">${learnerProfile.recurringPatterns.map(item => `<span>${escapeHtml(item.pattern)} · ${item.count} 次</span>`).join('')}</div>
        </div>
        ` : ''}
        ${reviewQueue.length > 0 ? `
        <div class="review-section">
          <h3 class="review-section-title">复习安排</h3>
          <div class="review-weak-list">
            ${reviewQueue.map((p, index) => `
              <div class="review-weak-item" data-point-index="${index}" data-urgency="${p.urgency}">
                <span class="rw-name">${escapeHtml(p.name)}</span>
                <div class="mastery-bar-wrap"><div class="mastery-bar" style="width:${Math.round((p.mastery || 0) * 100)}%"></div></div>
                <span class="mastery-pct">${Math.round((p.mastery || 0) * 100)}%</span>
                <span class="review-due">${p.label}${p.mistakeCount ? ` · ${p.mistakeCount} 次错题` : ''}${p.recentFailureCount ? ` · ${p.recentFailureCount} 次近期失败` : ''}</span>
                <button class="btn-secondary review-point-action" type="button">开始复习</button>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        ${recentMistakes.length > 0 ? `
        <div class="review-section">
          <h3 class="review-section-title">近期错题 (${recentMistakes.length})</h3>
          <div class="review-mistake-list">
            ${recentMistakes.map((m, index) => `
              <div class="review-mistake-card" data-mistake-index="${index}">
                <div class="rm-question">${escapeHtml(m.question)}</div>
                <div class="rm-answers">
                  <span class="rm-your">你的答案：<strong>${escapeHtml(m.student_answer)}</strong></span>
                  <span class="rm-correct">正确答案：<strong>${escapeHtml(m.correct_answer)}</strong></span>
                </div>
                ${m.knowledge_point ? `<div class="rm-kp">知识点：${escapeHtml(m.knowledge_point)}</div>` : ''}
                <button class="btn-secondary review-mistake-action" type="button">请老师带我重做</button>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
    container.querySelectorAll('.review-point-action').forEach(button => {
      button.addEventListener('click', () => {
        const point = reviewQueue[Number(button.closest('.review-weak-item').dataset.pointIndex)];
        openTeacherWithDraft(subjectId, `老师，请带我复习“${point.name}”。我目前的掌握度约为 ${Math.round(Number(point.mastery || 0) * 100)}%。请先用一个短问题检查我具体卡在哪里，再安排讲解和练习。`);
      });
    });
    container.querySelectorAll('.review-mistake-action').forEach(button => {
      button.addEventListener('click', () => {
        const mistake = recentMistakes[Number(button.closest('.review-mistake-card').dataset.mistakeIndex)];
        openTeacherWithDraft(subjectId, `老师，请带我重新分析这道错题。\n题目：${mistake.question}\n我当时的答案：${mistake.student_answer}\n正确答案：${mistake.correct_answer}\n请先判断我的错误类型，再通过追问让我自己改正。`);
      });
    });
  } catch (e) {
    renderModuleEmptyView(container, { icon: ICONS.review, title: '加载失败', description: String(e) });
  }
}

function renderSettingsView(container, tabId = 'setting-set1') {
  const sectionId = tabId.replace('setting-', '');

  switch (sectionId) {
    case 'set2': renderInterfaceSettings(container); break;
    case 'set3': renderDataManagement(container); break;
    case 'set4': renderAboutSettings(container); break;
    case 'set1':
    default:     renderModelSettings(container); break;
  }
}

// ---------- 设置：模型 ----------
function renderModelSettings(container) {
  container.innerHTML = `
    <div class="settings-view">
      <div class="settings-header"><h2>设置</h2></div>
      <div class="settings-content">
        <div class="settings-section">
          <h3>${ICONS.cpu} AI 老师设置</h3>
          <div class="settings-item">
            <label for="settingsChatModel">聊天模型</label>
            <input id="settingsChatModel" type="text" autocomplete="off" value="${escapeHtml(APP_CONFIG.models.chat)}" />
          </div>
          <div class="settings-item">
            <label for="settingsBaseUrl">API 地址</label>
            <input id="settingsBaseUrl" type="url" autocomplete="off" value="${escapeHtml(APP_CONFIG.base_url)}" placeholder="http://127.0.0.1:8088" />
          </div>
          <div class="settings-item">
            <label for="settingsApiKey">API 密钥</label>
            <input id="settingsApiKey" type="password" autocomplete="off" value="${escapeHtml(APP_CONFIG.api_key)}" />
          </div>
          <div class="settings-actions">
            <button id="settingsImportHermes" type="button" class="btn-secondary">从 Hermes 导入</button>
            <button id="settingsTest" type="button" class="btn-secondary">测试连接</button>
            <button id="settingsSave" type="button" class="btn-primary">保存并应用</button>
          </div>
          <p id="settingsFeedback" class="settings-feedback" role="status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  `;

  const baseUrlInput = container.querySelector('#settingsBaseUrl');
  const apiKeyInput = container.querySelector('#settingsApiKey');
  const chatModelInput = container.querySelector('#settingsChatModel');
  const feedback = container.querySelector('#settingsFeedback');
  const buttons = [...container.querySelectorAll('.settings-actions button')];

  const setBusy = busy => buttons.forEach(button => { button.disabled = busy; });
  const setFeedback = (message, tone = '') => {
    feedback.textContent = message;
    feedback.dataset.tone = tone;
  };
  const collectConfig = () => buildConfigPayload(APP_CONFIG, {
    baseUrl: baseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    chatModel: chatModelInput.value.trim(),
  });
  const applyConfig = config => {
    APP_CONFIG = config;
    baseUrlInput.value = config.base_url;
    apiKeyInput.value = config.api_key;
    chatModelInput.value = config.models.chat;
    if ($('#statusModel')) $('#statusModel').textContent = config.models.chat;
  };

  container.querySelector('#settingsImportHermes').addEventListener('click', async () => {
    setBusy(true);
    setFeedback('正在读取本机 Hermes 配置…');
    try {
      applyConfig(await invoke('import_hermes_config'));
      const health = await checkApiConnection();
      setFeedback(health.message || '已从 Hermes 导入配置', health.status === 'online' ? 'success' : 'error');
    } catch (error) {
      setFeedback(`导入失败：${error}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  container.querySelector('#settingsTest').addEventListener('click', async () => {
    setBusy(true);
    setFeedback('正在测试连接…');
    try {
      const candidate = collectConfig();
      const health = await invoke('check_api_health', {
        baseUrl: candidate.base_url,
        apiKey: candidate.api_key,
        model: candidate.models?.chat || '',
      });
      updateConnectionStatus(health);
      setFeedback(health.message, health.status === 'online' ? 'success' : 'error');
    } catch (error) {
      setFeedback(`测试失败：${error}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  container.querySelector('#settingsSave').addEventListener('click', async () => {
    setBusy(true);
    setFeedback('正在保存配置…');
    try {
      applyConfig(await invoke('save_config', { config: collectConfig() }));
      const health = await checkApiConnection();
      setFeedback(
        health.status === 'online' ? '配置已保存，AI 老师在线' : health.message,
        health.status === 'online' ? 'success' : 'error',
      );
    } catch (error) {
      setFeedback(`保存失败：${error}`, 'error');
    } finally {
      setBusy(false);
    }
  });
}

// ---------- 设置：界面 ----------
function renderInterfaceSettings(container) {
  const currentTheme = localStorage.getItem('warmclassroom.theme') || 'light';
  const currentFontSize = localStorage.getItem('warmclassroom.fontSize') || 'medium';
  const proactiveEnabled = localStorage.getItem('warmclassroom.teacher.proactive') !== 'off';
  const voiceSettings = readTeacherVoiceSettings();
  const voiceSupported = teacherVoice.getSnapshot().supported;
  const voiceStatus = voiceSupported
    ? teacherVoiceModeDescription(voiceSettings)
    : '当前系统没有可用的语音合成功能。';

  container.innerHTML = `
    <div class="settings-view">
      <div class="settings-header"><h2>界面设置</h2></div>
      <div class="settings-content">
        <div class="settings-section">
          <h3>${ICONS.palette} 外观</h3>
          <div class="settings-item">
            <label>主题</label>
            <div class="settings-toggle-group">
              <button data-theme-choice="light" class="btn-toggle ${currentTheme === 'light' ? 'active' : ''}" type="button">浅色</button>
              <button data-theme-choice="dark" class="btn-toggle ${currentTheme === 'dark' ? 'active' : ''}" type="button">深色</button>
            </div>
          </div>
          <div class="settings-item">
            <label>字体大小</label>
            <div class="settings-toggle-group">
              <button data-font-choice="small" class="btn-toggle ${currentFontSize === 'small' ? 'active' : ''}" type="button">小</button>
              <button data-font-choice="medium" class="btn-toggle ${currentFontSize === 'medium' ? 'active' : ''}" type="button">中</button>
              <button data-font-choice="large" class="btn-toggle ${currentFontSize === 'large' ? 'active' : ''}" type="button">大</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <h3>${ICONS.messageSquare} 课堂互动</h3>
          <div class="settings-item">
            <label>老师适时提醒</label>
            <div class="settings-toggle-group" role="group" aria-label="老师适时提醒">
              <button data-proactive-choice="on" class="btn-toggle ${proactiveEnabled ? 'active' : ''}" type="button">开启</button>
              <button data-proactive-choice="off" class="btn-toggle ${proactiveEnabled ? '' : 'active'}" type="button">关闭</button>
            </div>
          </div>
          <p class="settings-desc">长时间未作答时提供一次轻提示，不会在后台连续调用模型。</p>
        </div>
        <div class="settings-section">
          <h3>${ICONS.volume2} 老师声音</h3>
          <div class="settings-item">
            <label id="teacherVoiceModeLabel">朗读方式</label>
            <div class="settings-toggle-group" role="group" aria-labelledby="teacherVoiceModeLabel">
              <button data-voice-mode="off" class="btn-toggle ${voiceSettings.mode === 'off' ? 'active' : ''}" type="button" aria-pressed="${voiceSettings.mode === 'off'}" ${voiceSupported ? '' : 'disabled'}>关闭</button>
              <button data-voice-mode="manual" class="btn-toggle ${voiceSettings.mode === 'manual' ? 'active' : ''}" type="button" aria-pressed="${voiceSettings.mode === 'manual'}" ${voiceSupported ? '' : 'disabled'}>点击朗读</button>
              <button data-voice-mode="auto" class="btn-toggle ${voiceSettings.mode === 'auto' ? 'active' : ''}" type="button" aria-pressed="${voiceSettings.mode === 'auto'}" ${voiceSupported ? '' : 'disabled'}>自动朗读</button>
            </div>
          </div>
          <div class="settings-item">
            <label for="teacherVoiceRate">朗读语速</label>
            <div class="teacher-voice-rate">
              <input id="teacherVoiceRate" type="range" min="0.75" max="1.25" step="0.05" value="${voiceSettings.rate}" aria-describedby="teacherVoiceStatus" ${voiceSupported ? '' : 'disabled'}>
              <output id="teacherVoiceRateValue" for="teacherVoiceRate">${voiceSettings.rate.toFixed(2)}×</output>
            </div>
          </div>
          <p class="settings-desc teacher-voice-status" id="teacherVoiceStatus" role="status">${voiceStatus}</p>
        </div>
        <div class="settings-section">
          <h3>${ICONS.code} 编辑器</h3>
          <div class="settings-item">
            <label>等宽字体</label>
            <span class="settings-value">Cascadia Code, Consolas, monospace</span>
          </div>
          <div class="settings-item">
            <label>Tab 大小</label>
            <span class="settings-value">4 空格</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // 主题切换
  container.querySelectorAll('[data-theme-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeChoice;
      localStorage.setItem('warmclassroom.theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      container.querySelectorAll('[data-theme-choice]').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === theme));
    });
  });

  // 字体大小切换
  container.querySelectorAll('[data-font-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.fontChoice;
      localStorage.setItem('warmclassroom.fontSize', size);
      document.documentElement.setAttribute('data-font-size', size);
      showToast(`界面字号已切换为${btn.textContent}`, 'success');
      container.querySelectorAll('[data-font-choice]').forEach(b => b.classList.toggle('active', b.dataset.fontChoice === size));
    });
  });

  container.querySelectorAll('[data-proactive-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.proactiveChoice;
      localStorage.setItem('warmclassroom.teacher.proactive', value);
      container.querySelectorAll('[data-proactive-choice]').forEach(button => {
        button.classList.toggle('active', button.dataset.proactiveChoice === value);
      });
      showToast(value === 'on' ? '老师适时提醒已开启' : '老师适时提醒已关闭', 'success');
    });
  });

  const updateVoiceSettingsUI = settings => {
    container.querySelectorAll('[data-voice-mode]').forEach(button => {
      const active = button.dataset.voiceMode === settings.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const status = container.querySelector('#teacherVoiceStatus');
    if (status) {
      status.textContent = teacherVoiceModeDescription(settings);
    }
    syncTeacherVoiceButtons();
  };

  container.querySelectorAll('[data-voice-mode]').forEach(button => {
    button.addEventListener('click', () => {
      const settings = writeTeacherVoiceSettings({
        ...readTeacherVoiceSettings(),
        mode: button.dataset.voiceMode,
      });
      teacherVoice.stop();
      updateVoiceSettingsUI(settings);
      const label = settings.mode === TEACHER_VOICE_MODES.AUTO
        ? '自动朗读'
        : settings.mode === TEACHER_VOICE_MODES.MANUAL ? '点击朗读' : '关闭';
      showToast(`老师声音已设为${label}`, 'success');
    });
  });

  const voiceRate = container.querySelector('#teacherVoiceRate');
  const voiceRateValue = container.querySelector('#teacherVoiceRateValue');
  voiceRate?.addEventListener('input', () => {
    const settings = writeTeacherVoiceSettings({
      ...readTeacherVoiceSettings(),
      rate: voiceRate.value,
    });
    voiceRateValue.textContent = `${settings.rate.toFixed(2)}×`;
  });
  voiceRate?.addEventListener('change', () => {
    showToast(`老师语速已设为 ${Number(voiceRate.value).toFixed(2)} 倍`, 'success');
  });
}

// ---------- 设置：数据管理 ----------
function renderDataManagement(container) {
  container.innerHTML = `
    <div class="settings-view">
      <div class="settings-header"><h2>数据管理</h2></div>
      <div class="settings-content">
        <div class="settings-section">
          <h3>${ICONS.database} 学习数据</h3>
          <p class="settings-desc">所有学习记录保存在本地 SQLite 数据库中。你可以导出备份或从备份恢复。</p>
          <div class="settings-actions">
            <button id="dataExport" type="button" class="btn-secondary">导出学习数据</button>
            <button id="dataImport" type="button" class="btn-secondary">导入学习数据</button>
          </div>
          <input type="file" id="dataImportFile" accept=".json" style="display:none" />
        </div>
        <div class="settings-section settings-danger-zone">
          <h3>危险操作</h3>
          <p class="settings-desc">重置将清除所有科目、笔记、作业、学习记录和聊天历史；AI 模型配置会保留。此操作不可撤销。</p>
          <div class="settings-actions">
            <button id="dataReset" type="button" class="btn-danger">重置所有数据</button>
          </div>
          <p id="dataFeedback" class="settings-feedback" role="status" aria-live="polite"></p>
        </div>
      </div>
    </div>
  `;

  const feedback = container.querySelector('#dataFeedback');
  const setFeedback = (msg, tone = '') => { feedback.textContent = msg; feedback.dataset.tone = tone; };

  // 导出
  container.querySelector('#dataExport').addEventListener('click', async () => {
    try {
      setFeedback('正在导出…');
      const data = await invoke('export_learning_data');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qisi-academy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback('导出成功', 'success');
    } catch (e) {
      setFeedback(`导出失败：${e}`, 'error');
    }
  });

  // 导入
  const fileInput = container.querySelector('#dataImportFile');
  container.querySelector('#dataImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      setFeedback('正在导入…');
      const text = await file.text();
      const data = JSON.parse(text);
      await invoke('import_learning_data', { data });
      state.chatHistory = {};
      await loadSubjects();
      updateSidebarForView(state.currentView);
      setFeedback('导入成功，学习数据已刷新', 'success');
    } catch (e) {
      setFeedback(`导入失败：${e}`, 'error');
    }
  });

  // 重置
  container.querySelector('#dataReset').addEventListener('click', async () => {
    if (!confirm('确定要重置所有数据吗？此操作不可撤销！')) return;
    if (!confirm('再次确认：所有科目、学习记录、聊天历史都将被删除。')) return;
    try {
      setFeedback('正在重置…');
      await invoke('reset_all_data');
      state.subjects = [];
      state.currentSubject = null;
      state.chatHistory = {};
      state.tabs = [];
      state.activeTab = null;
      updateSidebarForView(state.currentView);
      renderEmptyWorkspace();
      setFeedback('已重置学习数据，AI 模型配置已保留。', 'success');
    } catch (e) {
      setFeedback(`重置失败：${e}`, 'error');
    }
  });
}

// ---------- 设置：关于 ----------
function renderAboutSettings(container) {
  container.innerHTML = `
    <div class="settings-view">
      <div class="settings-header"><h2>关于</h2></div>
      <div class="settings-content">
        <div class="settings-section">
          <h3>${ICONS.info} 启思学堂</h3>
          <div class="settings-item"><label>版本</label><span class="settings-value">0.1.0</span></div>
          <div class="settings-item"><label>框架</label><span class="settings-value">Tauri v2 + Rust</span></div>
          <div class="settings-item"><label>前端</label><span class="settings-value">Vanilla JS + Vite</span></div>
          <div class="settings-item"><label>存储</label><span class="settings-value">SQLite (本地)</span></div>
          <div class="settings-item"><label>AI 模型</label><span class="settings-value">${escapeHtml(APP_CONFIG.models.chat)}</span></div>
        </div>
        <div class="settings-section">
          <h3>${ICONS.book} 说明</h3>
          <p class="settings-desc">启思学堂会把科目、笔记、作业和学习档案保存在本机 SQLite 数据库中。课堂提问会发送到你配置的模型网关以生成教师回复；应用不会把 API 密钥显示在课堂内容或状态栏中。</p>
        </div>
      </div>
    </div>
  `;
}

function renderPlaceholderView(container, title) {
  container.innerHTML = `
    <div class="placeholder" role="alert">
      <div class="ph-icon" aria-hidden="true">${ICONS.warning}</div>
      <h2>无法打开“${escapeHtml(title)}”</h2>
      <p>这个标签的内容类型无效或已被移除。关闭标签后可以继续使用其他学习模块。</p>
      <button class="welcome-action" id="recoverWorkspace" type="button">${ICONS.close}<span>关闭无效标签</span></button>
    </div>
  `;
  container.querySelector('#recoverWorkspace').addEventListener('click', () => closeTab(state.activeTab));
}

function renderEmptyWorkspace() {
  renderTabs();
  $('#view').innerHTML = `
    <div class="placeholder">
      <div class="ph-icon" aria-hidden="true">${ICONS.book}</div>
      <h2>选择科目，开始课堂</h2>
      <p>创建真实科目后，课堂会在新的编辑器标签中打开。</p>
      <div class="welcome-actions">
        <button type="button" class="welcome-action primary" data-workbench-action="new-subject">
          ${ICONS.book}<span>新建科目</span>
        </button>
        <button type="button" class="welcome-action" data-workbench-action="command-center">
          ${ICONS.search || ICONS.helpCircle}<span>命令中心</span><kbd>Ctrl+K</kbd>
        </button>
      </div>
    </div>
  `;
  if ($('#editorBreadcrumb')) $('#editorBreadcrumb').innerHTML = '<span>工作区</span><span class="breadcrumb-separator">/</span><span>欢迎</span>';
  if ($('#statusLesson')) $('#statusLesson').textContent = '未开始';
}

// ============ 右侧栏：我的学习档案 ============
function initRightPanel() {
  document.querySelectorAll('.inspector-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.inspector-tab').forEach(item => item.classList.toggle('active', item === tab));
      const tabName = tab.dataset.tab;
      if (tabName === 'files') {
        renderFileTreePanel();
      } else if (tabName === 'profile') {
        const subject = state.subjects.find(s => s.id === state.currentSubject);
        if (subject) updateRightPanel(subject);
      }
    });
  });
}

// ============ 文件树面板 ============
const programmingCategories = ['programming', 'code', 'python', 'javascript', 'java', 'c_cpp'];

function isSubjectCoding(subject) {
  if (!subject) return false;
  if (subject.category && programmingCategories.includes(subject.category)) return true;
  const codingKeywords = ['编程', 'python', 'javascript', 'java', 'c++', 'coding', '算法', '开发', '前端', '后端', 'web'];
  const name = (subject.name || '').toLowerCase();
  return codingKeywords.some(kw => name.includes(kw));
}

function toggleFileTreeTab(show) {
  const tab = $('#fileTreeTab');
  if (tab) tab.style.display = show ? '' : 'none';
}

let currentOpenFile = null;

async function renderFileTreePanel() {
  const rightBody = $('#rightBody');
  if (!rightBody || !state.currentSubject) return;

  rightBody.innerHTML = `
    <div class="file-tree-panel">
      <div class="file-tree-header">
        <span class="ft-title">项目文件</span>
        <div class="ft-actions">
          <button class="ft-btn" id="ftNewFile" title="新建文件">+F</button>
          <button class="ft-btn" id="ftNewFolder" title="新建文件夹">+D</button>
          <button class="ft-btn" id="ftRefresh" title="刷新">R</button>
        </div>
      </div>
      <div class="file-tree" id="fileTree"></div>
    </div>
  `;

  const treeEl = rightBody.querySelector('#fileTree');

  async function loadTree() {
    try {
      const files = await invoke('list_project_files', { subjectId: state.currentSubject });
      treeEl.innerHTML = renderFileNodes(files, '');
    } catch (e) {
      treeEl.innerHTML = `<div class="ft-error">加载失败：${e}</div>`;
    }
  }

  function renderFileNodes(entries, parentPath) {
    if (!entries || entries.length === 0) return '<div class="ft-empty">空文件夹</div>';
    return entries.map(entry => {
      const icon = entry.is_dir ? '[D]' : getFileIcon(entry.name);
      if (entry.is_dir) {
        return `
          <div class="ft-folder" data-path="${entry.path}">
            <div class="ft-item ft-folder-header" data-path="${entry.path}">
              <span class="ft-icon">> ${icon}</span>
              <span class="ft-name">${entry.name}</span>
            </div>
            <div class="ft-children" style="display:none">
              ${renderFileNodes(entry.children || [], entry.path)}
            </div>
          </div>
        `;
      }
      return `
        <div class="ft-item ft-file ${currentOpenFile === entry.path ? 'active' : ''}" data-path="${entry.path}">
          <span class="ft-icon">${icon}</span>
          <span class="ft-name">${entry.name}</span>
        </div>
      `;
    }).join('');
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop()?.toLowerCase();
    const icons = { py: '[PY]', js: '[JS]', html: '[H]', css: '[C]', json: '{}', md: '[M]', txt: '[T]', rs: '[RS]', ts: '[TS]' };
    return icons[ext] || '[F]';
  }

  // 文件夹展开/折叠
  treeEl.addEventListener('click', async (e) => {
    const folderHeader = e.target.closest('.ft-folder-header');
    if (folderHeader) {
      const folder = folderHeader.closest('.ft-folder');
      const children = folder.querySelector('.ft-children');
      const arrow = folderHeader.querySelector('.ft-icon');
      if (children.style.display === 'none') {
        children.style.display = 'block';
        arrow.textContent = arrow.textContent.replace('>', 'v');
      } else {
        children.style.display = 'none';
        arrow.textContent = arrow.textContent.replace('v', '>');
      }
      return;
    }

    const fileItem = e.target.closest('.ft-file');
    if (fileItem) {
      const filePath = fileItem.dataset.path;
      await openFileInEditor(filePath);
    }
  });

  // 新建文件
  rightBody.querySelector('#ftNewFile').addEventListener('click', async () => {
    const name = prompt('文件名（如 hello.py）：');
    if (!name) return;
    try {
      await invoke('create_project_file', { subjectId: state.currentSubject, filePath: name, isDir: false });
      await loadTree();
    } catch (e) { showToast('创建失败：' + e, 'error'); }
  });

  // 新建文件夹
  rightBody.querySelector('#ftNewFolder').addEventListener('click', async () => {
    const name = prompt('文件夹名：');
    if (!name) return;
    try {
      await invoke('create_project_file', { subjectId: state.currentSubject, filePath: name, isDir: true });
      await loadTree();
    } catch (e) { showToast('创建失败：' + e, 'error'); }
  });

  // 刷新
  rightBody.querySelector('#ftRefresh').addEventListener('click', loadTree);

  await loadTree();
}

async function openFileInEditor(filePath) {
  const subjectId = state.currentSubject;
  if (!subjectId) return;

  try {
    const content = await invoke('read_project_file', { subjectId, filePath });
    currentOpenFile = filePath;

    // 打开新标签页显示文件
    const tabId = `file-${subjectId}-${filePath}`;
    const fileName = filePath.split('/').pop();
    openTab(tabId, fileName, 'code-file');

    // 在标签页中渲染代码编辑器
    const view = $('#view');
    view.innerHTML = `<div class="code-file-editor" id="codeFileEditor"></div>`;

    // 动态创建 CodeMirror 编辑器
    try {
      const { createPracticeEditor } = await import('./codemirror-setup.js');
      const container = view.querySelector('#codeFileEditor');
      const editor = createPracticeEditor(container, {
        initialCode: content,
        placeholder: '开始编辑...',
      });

      // 添加工具栏
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';
      toolbar.innerHTML = `
        <span class="code-file-path">${filePath}</span>
        <div class="code-toolbar-actions">
          <button class="btn-secondary" id="codeSave" type="button">保存</button>
          <button class="btn-secondary" id="codeRun" type="button">运行</button>
        </div>
      `;
      container.prepend(toolbar);

      container.querySelector('#codeSave').addEventListener('click', async () => {
        try {
          await invoke('write_project_file', { subjectId, filePath, content: editor.getValue() });
          showToast('已保存', 'success');
        } catch (e) { showToast('保存失败：' + e, 'error'); }
      });

      if (filePath.endsWith('.py')) {
        container.querySelector('#codeRun').addEventListener('click', async () => {
          try {
            const result = await invoke('run_python_code', { code: editor.getValue(), testCode: '' });
            const output = result.stdout || result.stderr || '(无输出)';
            showToast(result.success ? '运行成功' : '运行出错', result.success ? 'success' : 'error');
            // 显示输出
            let outputEl = container.querySelector('.code-output');
            if (!outputEl) {
              outputEl = document.createElement('pre');
              outputEl.className = 'code-output';
              container.appendChild(outputEl);
            }
            outputEl.textContent = output;
          } catch (e) { showToast('运行失败：' + e, 'error'); }
        });
      } else {
        container.querySelector('#codeRun').style.display = 'none';
      }

    } catch (e) {
      view.querySelector('#codeFileEditor').innerHTML = `
        <div class="code-toolbar">
          <span class="code-file-path">${filePath}</span>
          <div class="code-toolbar-actions">
            <button class="btn-secondary" id="codeSaveFallback" type="button">保存</button>
          </div>
        </div>
        <textarea class="code-fallback-editor" id="codeFallbackEditor" spellcheck="false">${escapeHtml(content)}</textarea>
      `;
      view.querySelector('#codeFallbackEditor').value = content;
      view.querySelector('#codeSaveFallback').addEventListener('click', async () => {
        try {
          await invoke('write_project_file', { subjectId, filePath, content: view.querySelector('#codeFallbackEditor').value });
          showToast('已保存', 'success');
        } catch (e) { showToast('保存失败：' + e, 'error'); }
      });
    }

    // 高亮活动文件
    $$('.ft-file').forEach(f => f.classList.toggle('active', f.dataset.path === filePath));

  } catch (e) {
    showToast('打开文件失败：' + e, 'error');
  }
}

// ============ 命令面板 ============
function initCommandPalette() {
  const overlay = $('#commandPalette');
  const input = $('#commandPaletteInput');
  const results = $('#commandResults');
  const trigger = $('#commandCenter');
  if (!overlay || !input || !results || !commandRegistry) return;

  let visibleCommands = commandRegistry.all();
  let activeIndex = 0;

  function open() {
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    trigger?.setAttribute('aria-expanded', 'true');
    input.value = '';
    renderResults(commandRegistry.all());
    input.focus();
  }

  function close() {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    trigger?.setAttribute('aria-expanded', 'false');
  }

  function updateActiveResult() {
    const buttons = [...results.querySelectorAll('.command-item')];
    buttons.forEach((button, index) => {
      button.classList.toggle('active', index === activeIndex);
      button.setAttribute('aria-selected', String(index === activeIndex));
    });
    buttons[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function executeCommand(index) {
    const command = visibleCommands[index];
    if (!command) return;
    if (commandRegistry.execute(command.id)) close();
  }

  function renderResults(list) {
    visibleCommands = list;
    activeIndex = 0;
    results.innerHTML = '';
    if (!list.length) {
      results.innerHTML = '<div class="command-empty">没有匹配的命令</div>';
      return;
    }
    list.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-item';
      button.setAttribute('role', 'option');
      button.disabled = !command.enabled;
      const icon = command.menu === 'learning' ? ICONS.chat
        : command.menu === 'help' ? ICONS.helpCircle
          : command.menu === 'view' ? ICONS.palette : ICONS.book;
      button.innerHTML = `<span class="inline-icon" aria-hidden="true">${icon}</span><span class="command-item-label">${command.label}</span>${command.kbd ? `<kbd>${command.kbd}</kbd>` : ''}`;
      button.addEventListener('mouseenter', () => { activeIndex = index; updateActiveResult(); });
      button.addEventListener('click', () => executeCommand(index));
      results.appendChild(button);
    });
    updateActiveResult();
  }

  input.addEventListener('input', () => {
    renderResults(commandRegistry.search(input.value));
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visibleCommands.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + direction + visibleCommands.length) % visibleCommands.length;
      updateActiveResult();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      executeCommand(activeIndex);
    }
  });

  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
  toggleCommandPalette = mode => {
    if (mode === 'open') open();
    else if (mode === 'close') close();
    else if (overlay.hidden) open();
    else close();
  };
  trigger?.addEventListener('click', () => toggleCommandPalette());
}

const LESSON_EVIDENCE_STATUS = Object.freeze({
  verified: { label: '已证明', icon: ICONS.check, tone: 'verified' },
  needs_recheck: { label: '待复查', icon: ICONS.review, tone: 'recheck' },
  active: { label: '正在验证', icon: ICONS.arrowRight, tone: 'active' },
  legacy: { label: '旧记录', icon: ICONS.info, tone: 'legacy' },
  pending: { label: '待验证', icon: ICONS.helpCircle, tone: 'pending' },
});

function renderLessonEvidencePanel(session = {}) {
  if (!session.lessonPlan || !session.lessonProgress) return '';
  const lessonPlan = normalizeLessonPlan(session.lessonPlan) || session.lessonPlan;
  const snapshot = buildLessonMasterySnapshot(lessonPlan, session.lessonProgress);
  if (!snapshot.steps.length || !snapshot.criteria.length) return '';
  const renderStatus = status => {
    const presentation = LESSON_EVIDENCE_STATUS[status] || LESSON_EVIDENCE_STATUS.pending;
    return `<span class="lesson-evidence-status is-${presentation.tone}"><span class="inline-icon" aria-hidden="true">${presentation.icon}</span>${presentation.label}</span>`;
  };
  return `
    <section class="profile-card lesson-evidence-panel" aria-label="本节掌握证据">
      <div class="lesson-evidence-heading">
        <div class="pf-label">本节验证</div>
        <span>${snapshot.verifiedCount}/${snapshot.totalCount} 已证明</span>
      </div>
      <div class="lesson-evidence-next">
        <span class="inline-icon" aria-hidden="true">${ICONS.arrowRight}</span>
        <div><span>当前只需</span><strong>${escapeHtml(snapshot.nextRequirement)}</strong></div>
      </div>
      <div class="lesson-evidence-group" aria-label="达标标准">
        ${snapshot.criteria.map(item => `
          <div class="lesson-evidence-row" title="${escapeHtml(item.evidence || item.label)}">
            <span class="lesson-evidence-label">${escapeHtml(item.label)}</span>
            ${renderStatus(item.status)}
          </div>
        `).join('')}
      </div>
      <div class="lesson-step-list" aria-label="课堂步骤">
        ${snapshot.steps.map(item => `
          <div class="lesson-step-row is-${item.status}">
            <span class="lesson-step-marker" aria-hidden="true"></span>
            <span>${escapeHtml(item.goal)}</span>
            <small>${LESSON_EVIDENCE_STATUS[item.status]?.label || '待验证'}</small>
          </div>
        `).join('')}
      </div>
      ${snapshot.hasLegacyProgress ? '<p class="lesson-evidence-legacy" role="note">旧课堂已保留步骤位置，但当时没有分级证据；从当前步骤开始重新按独立证据验证。</p>' : ''}
    </section>
  `;
}

async function updateRightPanel(subject) {
  const rightBody = $('#rightBody');
  const history = state.chatHistory[subject.id] || [];
  const studentTurns = history.filter(message => message.role === 'user').length;

  // 获取真实学习数据
  let knowledgePoints = [];
  let mistakes = [];
  let events = [];
  let sessionJson = null;
  let canonicalComponents = [];
  let evidenceRecords = [];
  try {
    [knowledgePoints, mistakes, events, sessionJson, canonicalComponents, evidenceRecords] = await Promise.all([
      invoke('get_knowledge_points', { subjectId: subject.id }).catch(() => []),
      invoke('get_mistakes', { subjectId: subject.id }).catch(() => []),
      invoke('get_learning_events', { subjectId: subject.id }).catch(() => []),
      invoke('get_teaching_session', { subjectId: subject.id }).catch(() => null),
      invoke('get_canonical_knowledge_components', { subjectId: subject.id }).catch(() => []),
      invoke('get_knowledge_evidence_records', { subjectId: subject.id, canonicalKey: null }).catch(() => []),
    ]);
  } catch {}
  if (!state.teachingSessions[subject.id] && sessionJson) {
    try { state.teachingSessions[subject.id] = JSON.parse(sessionJson); } catch {}
  }

  const totalMastery = knowledgePoints.length > 0
    ? Math.round(knowledgePoints.reduce((s, p) => s + (p.mastery || 0), 0) / knowledgePoints.length * 100)
    : 0;
  const weakPoints = knowledgePoints.filter(p => (p.mastery || 0) < 0.5);
  const evidenceProfiles = canonicalComponents.map(component => {
    const records = evidenceRecords.filter(record => record.canonical_key === component.canonical_key);
    const derived = deriveEvidenceStage(records);
    const legacy = knowledgePoints.find(point => point.name === component.name)?.mastery || 0;
    return { ...component, ...derived, mastery: projectMasteryFromEvidence(records, { legacyMastery: legacy }) };
  });
  const advancedProfiles = evidenceProfiles.filter(item => item.canAdvance);
  const recentEvents = (events || []).slice(0, 5);
  const teachingSession = state.teachingSessions[subject.id] || {};
  const lastLessonSummary = teachingSession.lastLessonSummary || null;
  const learnerProfile = buildLearnerProfile(
    knowledgePoints,
    mistakes,
    events,
    lastLessonSummary,
    new Date(),
    teachingSession.teachingPreferences,
  );
  const teachingMemory = learnerProfile.teachingMemory;
  const paceAndRepresentation = [
    teachingMemory.preferences.pace?.label,
    teachingMemory.preferences.representation?.label,
  ].filter(Boolean).join('；');
  const effectiveTeaching = teachingMemory.effectiveStrategies
    .map(item => `${item.label}（独立成功 ${item.independentSuccesses} 次）`).join('；');
  const teachingToChange = teachingMemory.avoidStrategies
    .map(item => `${item.label}（困难 ${item.difficulties} 次）`).join('；');
  const patternLabels = {
    hint_dependence: '完成练习时较依赖提示',
    off_by_one: '边界条件容易差一位',
    concept_gap: '概念与应用尚未连起来',
    syntax_error: '语法细节需要巩固',
  };

  rightBody.innerHTML = `
    <div class="profile-card">
      <div class="profile-field">
        <div class="pf-label">当前科目</div>
        <div class="pf-value subject-value"><span class="inline-icon" aria-hidden="true">${getSubjectIcon(subject.id)}</span>${escapeHtml(subject.name)}</div>
      </div>
      <div class="profile-field">
        <div class="pf-label">摸底状态</div>
        <div class="pf-value">${subject.assessed ? `<span class="status-with-icon success"><span class="inline-icon" aria-hidden="true">${ICONS.check}</span>已完成</span>` : `<span class="status-with-icon pending">待完成</span>`}</div>
      </div>
      ${evidenceProfiles.length > 0 ? `
      <div class="profile-field">
        <div class="pf-label">学习证据</div>
        <div class="pf-value evidence-overview"><strong>${advancedProfiles.length} / ${evidenceProfiles.length}</strong><span>项当前可推进</span></div>
      </div>
      ` : knowledgePoints.length > 0 ? `
      <div class="profile-field legacy-mastery-field">
        <div class="pf-label">历史估计</div>
        <div class="pf-value"><span class="mastery-pct">${totalMastery}%</span><small>旧课程数据，尚未分级验证</small></div>
      </div>
      ` : ''}
      <div class="profile-field">
        <div class="pf-label">互动统计</div>
        <div class="pf-value">${studentTurns > 0 ? `${studentTurns} 轮对话` : '尚未开始'}${mistakes.length > 0 ? ` · ${mistakes.length} 道错题` : ''}</div>
      </div>
    </div>
    ${evidenceProfiles.length ? `
    <div class="profile-card evidence-profile-card">
      <div class="pf-label">当前证据阶段</div>
      <div class="evidence-stage-list">
        ${evidenceProfiles.slice(0, 6).map(item => `
          <div class="evidence-stage-row" data-stage="${item.stage}">
            <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(EVIDENCE_STAGE_META[item.stage]?.label || '尚无证据')}</span></div>
            <small>${item.pendingRetention ? '当前可推进 · 待延迟复习' : escapeHtml(item.next)}</small>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
    ${renderLessonEvidencePanel(teachingSession)}
    ${weakPoints.length > 0 ? `
    <div class="profile-card">
      <div class="pf-label" style="margin-bottom:6px">薄弱知识点</div>
      ${weakPoints.slice(0, 5).map(p => `
        <div class="knowledge-point-row">
          <span class="kp-name">${escapeHtml(p.name)}</span>
          <div class="mastery-bar-wrap small"><div class="mastery-bar" style="width:${Math.round((p.mastery || 0) * 100)}%"></div></div>
        </div>
      `).join('')}
    </div>
    ` : ''}
    ${(learnerProfile.nextFocus || learnerProfile.strengths.length || learnerProfile.recurringPatterns.length || paceAndRepresentation || effectiveTeaching || teachingToChange) ? `
    <div class="profile-card">
      <div class="pf-label" style="margin-bottom:6px">老师的持续观察</div>
      ${learnerProfile.nextFocus ? `<div class="profile-observation"><span>下次优先</span><strong>${escapeHtml(learnerProfile.nextFocus)}</strong></div>` : ''}
      ${learnerProfile.strengths.length ? `<div class="profile-observation"><span>已有证据</span><strong>${escapeHtml(learnerProfile.strengths.map(item => item.name).join('、'))}</strong></div>` : ''}
      ${learnerProfile.recurringPatterns.length ? `<div class="profile-observation"><span>持续关注</span><strong>${escapeHtml(learnerProfile.recurringPatterns.map(item => patternLabels[item.pattern] || item.pattern).join('、'))}</strong></div>` : ''}
      ${paceAndRepresentation ? `<div class="profile-observation"><span>学习节奏</span><strong>${escapeHtml(paceAndRepresentation)}</strong></div>` : ''}
      ${effectiveTeaching ? `<div class="profile-observation"><span>有效讲法</span><strong>${escapeHtml(effectiveTeaching)}</strong></div>` : ''}
      ${teachingToChange ? `<div class="profile-observation profile-observation-attention"><span>需要换用</span><strong>${escapeHtml(teachingToChange)}</strong></div>` : ''}
    </div>
    ` : ''}
    ${recentEvents.length > 0 ? `
    <div class="profile-card">
      <div class="pf-label" style="margin-bottom:6px">最近活动</div>
      ${recentEvents.map(e => {
        const typeLabels = {
          assessment_complete: '摸底完成', chat_turn: '对话', practice_submit: '代码练习', quiz_answer: '小测',
          teaching_preference: '学习节奏更新', teacher_strategy_outcome: '教学方法验证',
        };
        const label = typeLabels[e.event_type] || e.event_type;
        const time = e.created_at ? new Date(e.created_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="event-row"><span class="event-type">${label}</span><span class="event-time">${time}</span></div>`;
      }).join('')}
    </div>
    ` : ''}
  `;
}

// ============ 状态栏 ============
function updateConnectionStatus(health) {
  const dot = $('#statusDot');
  const text = $('#statusText');
  const presentation = connectionPresentation(health);
  dot.className = 'dot';
  if (presentation.tone !== 'neutral') dot.classList.add(presentation.tone);
  text.textContent = presentation.text;
  text.title = health?.message || presentation.text;
}
