import { execSync } from "child_process";
import process from "process";

if (process.platform === "win32") {
  try {
    // Terminate any running airwsjtx.exe or airwsjtx_bridge.exe so Windows file-locking
    // does not prevent rustc / linker from overwriting target/release/airwsjtx.exe.
    execSync("taskkill /F /IM airwsjtx.exe /IM airwsjtx_bridge.exe >nul 2>&1 || rem", {
      shell: "cmd.exe",
      stdio: "ignore",
    });
  } catch {
    // Ignore errors when no matching processes are running
  }
}
