import { app } from "electron"
import { saDisplayName } from "./sa-variant.ts"

/** Vite embeds an explicit override. The installed SA app defaults to its hosted backend. */
export const backendUrl = import.meta.env.VITE_DESKFLEET_SERVER_URL || (
  app.isPackaged && saDisplayName(app.name)
    ? "https://deskfleet.yetanother.ai"
    : "http://localhost:8080"
)
