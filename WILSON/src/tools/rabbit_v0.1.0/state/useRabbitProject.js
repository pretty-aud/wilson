// ============================================================
// RABBIT v0.1 — useRabbitProject (narrow active-project hook)
// ============================================================
//
// Returns only the slice of RabbitContext that views editing a
// single project care about. Components that don't need the
// projects index or adapter switching should consume this hook
// instead of useRabbit() so they re-render less often once we
// add memoization in v0.2.

import { useRabbit } from './RabbitProvider';

export function useRabbitProject() {
  const ctx = useRabbit();
  if (!ctx) return null;
  return {
    // identity
    activeProjectId: ctx.activeProjectId,
    project:         ctx.project,
    loadingProject:  ctx.loadingProject,
    error:           ctx.error,

    // bundle slices
    phases:        ctx.phases,
    assets:        ctx.assets,
    tasks:         ctx.tasks,
    dependencies:  ctx.dependencies,
    taskLinks:     ctx.taskLinks,
    files:         ctx.files,
    assetVersions: ctx.assetVersions,
    comments:      ctx.comments,
    ingestionRuns: ctx.ingestionRuns,

    // intake
    activeIngestion:  ctx.activeIngestion,
    startIngestion:   ctx.startIngestion,
    acceptIngestion:  ctx.acceptIngestion,
    discardIngestion: ctx.discardIngestion,

    // mutators (project-scoped)
    updateProject:      ctx.updateProject,
    addPhase:           ctx.addPhase,
    updatePhase:        ctx.updatePhase,
    deletePhase:        ctx.deletePhase,
    reorderPhases:      ctx.reorderPhases,
    addAsset:           ctx.addAsset,
    updateAsset:        ctx.updateAsset,
    deleteAsset:        ctx.deleteAsset,
    reorderAssets:      ctx.reorderAssets,
    addTask:            ctx.addTask,
    updateTask:         ctx.updateTask,
    deleteTask:         ctx.deleteTask,
    linkTasks:          ctx.linkTasks,
    unlinkTasks:        ctx.unlinkTasks,
    addTaskLink:        ctx.addTaskLink,
    removeTaskLink:     ctx.removeTaskLink,
    uploadFile:         ctx.uploadFile,
    markFileCoreDefiner: ctx.markFileCoreDefiner,

    // selectors
    selectAssetsByPhase:        ctx.selectAssetsByPhase,
    selectTasksByAsset:         ctx.selectTasksByAsset,
    selectAssetDerivedStatus:   ctx.selectAssetDerivedStatus,
    selectAssetStatusWarning:   ctx.selectAssetStatusWarning,
    selectCriticalPath:         ctx.selectCriticalPath,
    selectVarianceForAsset:     ctx.selectVarianceForAsset,
    selectVarianceForProject:   ctx.selectVarianceForProject,
    selectProjectBudgetRollup:  ctx.selectProjectBudgetRollup,
  };
}
