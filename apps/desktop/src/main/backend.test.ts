import { afterEach, expect, it, vi } from "vitest"

const { app } = vi.hoisted(() => ({ app: { isPackaged: false, name: "" } }))
vi.mock("electron", () => ({ app }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it.each([
  { name: "DeskFleet Workspace Agent", packaged: true, configured: undefined, expected: "https://deskfleet.yetanother.ai" },
  { name: "DeskFleet Workspace Agent", packaged: true, configured: "", expected: "https://deskfleet.yetanother.ai" },
  { name: "DeskFleet Workspace Agent", packaged: true, configured: "https://deskfleet.example.org", expected: "https://deskfleet.example.org" },
  { name: "DeskFleet Workspace Agent", packaged: false, configured: undefined, expected: "http://localhost:8080" },
  { name: "DeskFleet SA Preview", packaged: true, configured: undefined, expected: "https://deskfleet.yetanother.ai" },
  { name: "deskfleet", packaged: true, configured: undefined, expected: "http://localhost:8080" },
])("resolves the backend for $name (packaged=$packaged, override=$configured)", async ({ name, packaged, configured, expected }) => {
  app.name = name
  app.isPackaged = packaged
  vi.stubEnv("VITE_DESKFLEET_SERVER_URL", configured)
  const { backendUrl } = await import("./backend.ts")
  expect(backendUrl).toBe(expected)
})
