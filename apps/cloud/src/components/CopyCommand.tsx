"use client";
import { useState } from "react";
export function CopyCommand({ command }: { command: string }) {
  const [message, setMessage] = useState("");
  return <div className="command-wrap"><code>{command}</code><button type="button" className="button" onClick={async () => {
    try { await navigator.clipboard.writeText(command); setMessage("Command copied"); }
    catch { setMessage("Select the command and copy it manually."); }
  }}>Copy command</button><span className="muted small" role="status">{message}</span></div>;
}
