// =============================================================================
// rabbitContext.js — R.A.B.B.I.T.'s context object, apart from its provider.
//
// RabbitProvider.jsx builds the cloud client when it is imported (through the
// Supabase adapter), and that throws where no Supabase address is configured
// — CI's unit tests, for one. A leaf component that only READS the provider's
// value (BinPoster, which every bin grid, table, take chip and the Scenes tab
// draw) takes it from here, so drawing a clip's tile never imports the
// provider. RabbitProvider provides this same context; its `useRabbit` reads it.
// =============================================================================
import { createContext, useContext } from 'react'

export const RabbitContext = createContext(null)

// The provider's value, or null outside one (a tile drawn on its own).
export function useRabbitContext() {
  return useContext(RabbitContext)
}
