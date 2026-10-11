import type { ClipForgeApi } from './index'

declare global {
  interface Window {
    cf: ClipForgeApi
  }
}

export {}
