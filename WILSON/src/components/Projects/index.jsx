// ============================================================
// Projects — barrel export
// ============================================================
//
// `default` is the page component the App router renders. The
// underlying split is intentional: ProjectsPage owns the IDB
// state, ProjectListPanel and ProjectDetailPanel are dumb views.
//
// History note: this used to be a single 534-line ProjectManager
// component. The split happened in v0.6 to make room for RABBIT
// project rows alongside the legacy IDB-backed Project Manager
// projects without making any one file larger.

export { default } from './ProjectsPage'
export { default as ProjectsPage } from './ProjectsPage'
export { default as ProjectListPanel } from './ProjectListPanel'
export { default as ProjectDetailPanel } from './ProjectDetailPanel'
