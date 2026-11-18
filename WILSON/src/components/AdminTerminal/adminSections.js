// adminSections.js — F11 (the review's shared-client C3): the Admin terminal's seven sections as ONE chunk.
// AdminTerminalPage.jsx loads this module the first time an admin's terminal is drawn (LazyPart): a person who is
// not an admin never loads it, and one dynamic import makes one chunk where seven would make seven requests.
// The page keeps its gate, its nav and its stylesheet, and draws the sections it names from here.
export { default as UsersSection } from './UsersSection'
export { default as CompanySection } from './CompanySection'
export { default as LogsSection } from './LogsSection'
export { default as DiagnosticsSection } from './DiagnosticsSection'
export { default as ChangeRequestsSection } from './ChangeRequestsSection'
export { default as ModelsSection } from './ModelsSection'
export { default as StorageSection } from './StorageSection'
