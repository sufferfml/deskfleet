/** The stable name is also the existing Electron profile and Keychain identity. */
export function saDisplayName(runtimeName: string): string | undefined {
  if (runtimeName === "DeskFleet Workspace Agent") return "DeskFleet SA"
  if (runtimeName === "DeskFleet SA Preview") return runtimeName
  return undefined
}
