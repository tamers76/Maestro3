/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LEGACY_STAGES_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
