/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The gateway's origin, set in `.env.local` (not committed). */
  readonly VITE_GATEWAY_URL: string;
}
