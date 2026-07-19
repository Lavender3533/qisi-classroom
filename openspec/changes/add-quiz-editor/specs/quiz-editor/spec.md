## ADDED Requirements

### Requirement: Docked quiz editor
The application SHALL present an AI-triggered classroom quiz in a dedicated bottom-docked editor instead of inserting the interactive question directly into the chat history.

#### Scenario: Teacher opens a quiz
- **WHEN** a structured teacher action contains `show_quiz` with a valid quiz
- **THEN** the application opens the quiz editor with the question, difficulty, knowledge point and answer controls visible
- **AND** the classroom context remains visible above the editor

#### Scenario: Student adjusts the workspace
- **WHEN** the student drags the quiz editor header or resize handle
- **THEN** the editor height changes within limits that preserve usable classroom and answer space

### Requirement: Quiz answer workflow
The quiz editor SHALL support the existing choice and fill question formats and SHALL provide a single explicit submission workflow.

#### Scenario: Student submits a choice answer
- **WHEN** the student selects an option and submits the quiz
- **THEN** the application locks the answer, shows correct or incorrect feedback, and records a `quiz_answer` learning event

#### Scenario: Student submits a fill answer
- **WHEN** the student enters a non-empty answer and submits the quiz
- **THEN** the application compares the normalized answer, locks the answer, and shows feedback

#### Scenario: Student submits an incorrect answer
- **WHEN** the submitted answer is incorrect
- **THEN** the application records the mistake with the question, student answer, correct answer and knowledge point

### Requirement: Recoverable quiz task
The application SHALL preserve an unanswered quiz as the current teaching task when the editor is hidden or the classroom is reopened.

#### Scenario: Student closes an unanswered quiz
- **WHEN** the student closes the editor before submitting
- **THEN** the editor hides without clearing the pending quiz action

#### Scenario: Student returns to the classroom
- **WHEN** a saved teaching session contains a pending `show_quiz` action
- **THEN** the quiz editor restores the unanswered quiz

#### Scenario: Student completes the quiz
- **WHEN** answer processing completes
- **THEN** the application clears the pending quiz action and allows the teacher to continue the lesson

### Requirement: Accessible editor interaction
The quiz editor MUST remain operable at the 900x600 minimum window size and through keyboard input.

#### Scenario: Keyboard answer submission
- **WHEN** keyboard focus is in a fill answer field and the student presses Ctrl+Enter
- **THEN** the application submits the answer without inserting unintended content

#### Scenario: Reduced motion preference
- **WHEN** the operating system requests reduced motion
- **THEN** opening, closing and resizing the editor do not depend on animated transitions

