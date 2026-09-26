// ============================================================
// RABBIT — ExperiencesView
// ============================================================
//
// The Experiences page: EntityListView with the experience entity. The
// list, its table and gallery, the detail and create popups, the
// filters, saved views and bulk select live once, in EntityListView.jsx,
// which LevelsView renders too (B4c, review R4-11). Everything the two
// pages differ in is this config; its fields are described at the top
// of EntityListView.jsx.

import { Sparkles } from 'lucide-react'
import EntityListView from './EntityListView'

const EXPERIENCE = {
  type: 'experience',
  noun: 'experience',
  nouns: 'experiences',
  Noun: 'Experience',
  Icon: Sparkles,
  collection: 'experiences',
  linkKey: 'experience_id',
  addMethod: 'addExperience',
  updateMethod: 'updateExperience',
  deleteMethod: 'deleteExperience',
  savedViewsKey: 'rabbit_experience_saved_views',
}

export default function ExperiencesView() {
  return <EntityListView entity={EXPERIENCE} />
}
