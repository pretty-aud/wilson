// ============================================================
// RABBIT v0.1 — useRabbitProjects (index-only hook)
// ============================================================
//
// Returns just the projects index + the actions a project list
// view needs (create / delete / pick active). Used by the
// Projects landing panel so it doesn't pull in the full bundle
// for whatever project is currently loaded.

import { useRabbit } from './RabbitProvider';

export function useRabbitProjects() {
  const ctx = useRabbit();
  if (!ctx) return null;
  return {
    adapterMode:          ctx.adapterMode,
    adapterStatus:        ctx.adapterStatus,
    switchAdapter:        ctx.switchAdapter,
    refreshProjectsIndex: ctx.refreshProjectsIndex,

    projectsIndex:   ctx.projectsIndex,
    activeProjectId: ctx.activeProjectId,

    createProject:    ctx.createProject,
    updateProject:    ctx.updateProject,
    deleteProject:    ctx.deleteProject,
    setActiveProject: ctx.setActiveProject,
  };
}
