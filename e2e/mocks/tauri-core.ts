export async function invoke(cmd: string, _args?: Record<string, unknown>): Promise<unknown> {
  if (cmd === "send_to_sidecar") return;
  if (cmd === "plugin:shell|open") return;
  return {};
}
