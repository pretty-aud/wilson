// RABBIT v0.1.0 — provider stub (Session 1 scaffold).
//
// Session 2 builds the real provider:
//   - adapter selection (Supabase / Local Server / Google Drive)
//   - project list + current project state
//   - draft intake state
//   - hooks: useRabbitProject, useRabbitProjects, useRabbitAdapter
//   - selectors: timelineRows, budgetRollups, atRiskTasks
//
// This stub exports a no-op provider so future imports resolve during scaffolding.

import React, { createContext, useContext } from 'react';

const RabbitContext = createContext(null);

export function RabbitProvider({ children }) {
  return <RabbitContext.Provider value={null}>{children}</RabbitContext.Provider>;
}

export function useRabbit() {
  return useContext(RabbitContext);
}
