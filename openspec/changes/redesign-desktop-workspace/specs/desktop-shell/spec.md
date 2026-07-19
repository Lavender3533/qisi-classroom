## ADDED Requirements

### Requirement: Desktop Workbench Shell
The application SHALL present a native desktop productivity workbench with a title bar, Activity Bar, primary sidebar, tabbed editor group, optional inspector, and status bar.

#### Scenario: Application opens at desktop size
- **WHEN** the application opens at 1200×800
- **THEN** all six workbench regions are visible without page scrolling
- **AND** the current learning tab remains the visual focus

#### Scenario: Application opens at minimum size
- **WHEN** the application opens at 900×600
- **THEN** the workbench remains usable without horizontal document overflow
- **AND** secondary panels can collapse to preserve the editor area

### Requirement: Desktop Navigation and Panels
The application SHALL support keyboard navigation, visible focus states, collapsible side panels, resizable panel widths, and local restoration of panel state.

#### Scenario: Student uses keyboard navigation
- **WHEN** the student uses Ctrl+1 through Ctrl+5, Ctrl+B, Ctrl+Shift+I, or Ctrl+K
- **THEN** the corresponding module, panel, or Command Center responds
- **AND** focus remains visibly indicated

#### Scenario: Student resizes a panel
- **WHEN** the student drags a panel separator
- **THEN** the panel width stays within its allowed range
- **AND** the selected width is restored on the next launch

### Requirement: UI UX Pro Max Compliance
The application SHALL use accessible contrast, Noto Sans SC typography, consistent SVG icons, 150–300ms non-layout-shifting transitions, and semantic labels for icon-only controls.

#### Scenario: UI quality review
- **WHEN** the desktop shell is reviewed before delivery
- **THEN** no UI control uses an emoji as its icon
- **AND** all icon-only buttons have an accessible label
- **AND** keyboard focus and reduced-motion behavior are present

### Requirement: Teaching Contract Preservation
The UI refactor SHALL preserve the existing teaching, assessment, practice, chat and Tauri command contracts.

#### Scenario: Student enters a subject after the refactor
- **WHEN** a subject is selected
- **THEN** the existing assessment or chat tab opens
- **AND** the existing teaching renderer continues to target the preserved DOM IDs
- **AND** no Tauri invoke command name is changed
