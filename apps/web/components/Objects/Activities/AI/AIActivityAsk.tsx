'use client'

// The Activity AI chat surface has been consolidated into the app-level
// AI Genie drawer (see components/Copilot/AICopilotDrawer.tsx). This module
// now only exports the shared AIMessage type used by the editor AI contexts.
export type AIMessage = {
  sender: string
  message: any
  type: 'ai' | 'user'
}
