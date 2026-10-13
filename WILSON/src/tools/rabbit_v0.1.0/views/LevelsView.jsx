// ============================================================
// RABBIT — LevelsView
// ============================================================
//
// The Levels page: EntityListView with the level entity. The list, its
// table and gallery, the detail and create popups, the filters, saved
// views and bulk select live once, in EntityListView.jsx, which
// ExperiencesView renders too (B4c, review R4-11). Everything the two
// pages differ in is this config; its fields are described at the top
// of EntityListView.jsx.

import { Gamepad2 } from 'lucide-react'
import EntityListView from './EntityListView'

const LEVEL = {
  type: 'level',
  noun: 'level',
  nouns: 'levels',
  Noun: 'Level',
  Icon: Gamepad2,
  collection: 'levels',
  linkKey: 'level_id',
  addMethod: 'addLevel',
  updateMethod: 'updateLevel',
  deleteMethod: 'deleteLevel',
  savedViewsKey: 'rabbit_level_saved_views',
}

export default function LevelsView() {
  return <EntityListView entity={LEVEL} />
}
