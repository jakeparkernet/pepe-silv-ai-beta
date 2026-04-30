# App Refactor Spec

This document defines the target class boundaries for `src/site/dev/js/app.js`.
The goal is to keep `App` as a composition root and move feature logic into focused classes.

## 1. `ArticleApiService`

Owns:
- URL normalization and queue-key generation
- Supported-site parsing
- Supabase reads and writes
- JSON parsing / recursive decoding
- Evidence batch loading

Public responsibilities:
- `healthCheck()`
- `getArticleByUrl(targetUrl)`
- `getOrEnqueueArticleQueueRow(targetUrl)`
- `getArticleQueueRowByUrl(targetUrl)`
- `fetchOwnershipTreeById(id)`
- `collectEvidence(ids)`
- URL helpers used by submit flow

Dependencies:
- Supabase client factory
- Fetch
- No DOM access

Notes:
- This class should be as pure as possible.
- All request logging can stay here if it is about API behavior, not UI behavior.

## 2. `ArticleSubmissionController`

Owns:
- Submit button / input flow
- Pending / deferred / timeout / resolved article state machine
- Queue polling
- Article status messages and timers
- Foreground fade behavior for submit flow

Public responsibilities:
- `bindEvents()`
- `onSubmitClicked()`
- `onUrlInputChanged()`
- `onUrlInputPasted()`
- `pollArticleStatus()`
- `handlePendingArticleState()`
- `renderResolvedArticle()`

Dependencies:
- `ArticleApiService`
- DOM refs for input, submit button, status text, foreground
- Scene/article rendering hooks
- Status view/controller hooks

Notes:
- This controller should own the flow, not the underlying data access.
- It should not parse the DOM outside of its assigned inputs.

## 3. `VisualizationController`

Owns:
- Three.js scene setup
- Renderer, camera, composer, LUT, and camera controller
- Article lighting intro animation
- Hover overlay
- Render loop
- Resize handling

Public responsibilities:
- `init()`
- `render()`
- `onWindowResize()`
- `setVisualizationMode(mode)`
- `applyResolvedArticleCameraView()`
- `applyArticleStatusCameraZoom()`
- `updateArticleLightingIntro()`

Dependencies:
- Three.js
- `CameraController`
- `TextService`
- `InputService`
- `ViewPool`
- `ArticleD3Graph`
- `ArticleStatus` and `ArticleStatusD3`

Notes:
- This class should own the canvas and scene lifecycle.
- UI toggles should be exposed as methods, not directly coupled to page chrome code.

## 4. `PageBackgroundController`

Owns:
- Background image selection and loading
- Focus-cycle animation
- Background hide/show behavior
- Activation of the Three.js canvas

Public responsibilities:
- `initialize()`
- `hidePageBackground()`
- `startFocusLoop()`
- `stopFocusLoop()`
- `activateThreeCanvas()`

Dependencies:
- Page background DOM elements
- Timers / `requestIdleCallback`

Notes:
- Keep the randomization and CSS variable updates isolated here.
- This should not know anything about article submission or detail panels.

## 5. `ChromeController`

Owns:
- Viewport metrics
- Mobile anchor positioning
- Support menu
- Share / new-search controls
- Relationship key rendering
- URL bar sync helpers
- Foreground visibility helpers

Public responsibilities:
- `initialize()`
- `updateViewportMetrics()`
- `setForegroundInteractive()`
- `showForeground()`
- `hideForeground()`
- `renderRelationshipKey()`
- `setVisualizationMode(mode)` for page chrome state

Dependencies:
- DOM refs for buttons, containers, banners, toolbar, and foreground
- Window resize / viewport APIs

Notes:
- This controller should own page chrome behavior, not scene behavior.
- It may receive callbacks from the scene controller when visual mode changes.

## 6. `DetailPanelController`

Owns:
- Detail-panel DOM creation
- Entity / relationship / evidence formatting
- Raw-value rendering
- Entity and evidence ID resolution
- Open / close behavior

Public responsibilities:
- `initialize()`
- `openDetailPanel()`
- `closeDetailPanel()`
- `openEntityDetailById()`
- `openEvidenceDetailById()`

Dependencies:
- Entity / relationship / evidence maps
- DOM refs for the detail panel

Notes:
- Keep the DOM builder helpers together.
- This class should not reach into the submission flow.

## 7. `DebugController`

Owns:
- Stats panel
- lil-gui setup
- TextService debug folders
- Material debug folders
- LUT selection wiring

Public responsibilities:
- `initialize()`
- `setupTextGui()`
- `setupMaterialGui()`
- `loadLut()`

Dependencies:
- Three.js renderer / scene refs
- `TextService`
- Material config objects

Notes:
- This is developer-only wiring and should be easy to disable.

## 8. `SummaryBannerController`

Owns:
- Summary banner text animation and visibility

Public responsibilities:
- `renderSummaryBanner(text)`

Dependencies:
- Summary banner DOM element

Notes:
- This is intentionally tiny and separate because it is a unique visual effect.

## 9. `App`

Owns:
- Composition root
- Shared dependency construction
- Controller instantiation
- Startup sequencing
- Cross-controller coordination

Responsibilities left in `App`:
- Build the shared dependency objects
- Start the scene and controllers
- Wire callbacks between controllers
- Export a single app instance for the page

Notes:
- `App` should stop containing feature logic after the refactor.
