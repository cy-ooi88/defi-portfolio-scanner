/**
 * @param {{
 *   state: { traceSessionId:number, traceStartedAt:string, traceEntries:any[], traceOverflowed:boolean },
 *   maxFieldChars: number,
 *   maxEntries: number,
 *   maskSecrets: (text:string) => string
 * }} deps
 */
export function createTraceLogger({ state, maxFieldChars, maxEntries, maskSecrets }) {
  function truncateTraceField(value) {
    const text = maskSecrets(String(value ?? ""));
    if (text.length <= maxFieldChars) {
      return text;
    }
    return `${text.slice(0, maxFieldChars)}...<truncated:${text.length - maxFieldChars}>`;
  }

  function normalizeTraceField(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string") {
      return truncateTraceField(value);
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return truncateTraceField(String(value));
    }
    try {
      return truncateTraceField(JSON.stringify(value));
    } catch {
      return truncateTraceField(String(value));
    }
  }

  function pushTrace(eventType, fields = {}) {
    const entry = {
      at: new Date().toISOString(),
      sessionId: state.traceSessionId,
      type: eventType,
      fields: {}
    };
    for (const [key, value] of Object.entries(fields || {})) {
      entry.fields[key] = normalizeTraceField(value);
    }
    if (state.traceEntries.length >= maxEntries) {
      state.traceOverflowed = true;
      if (state.traceEntries.length === maxEntries) {
        state.traceEntries.push({
          at: entry.at,
          sessionId: state.traceSessionId,
          type: "trace_overflow",
          fields: {
            maxEntries: String(maxEntries),
            note: "Further events were omitted from in-memory trace buffer."
          }
        });
      }
      return;
    }
    state.traceEntries.push(entry);
  }

  function startTraceSession(label = "manual_lookup") {
    state.traceSessionId += 1;
    state.traceStartedAt = new Date().toISOString();
    state.traceEntries = [];
    state.traceOverflowed = false;
    pushTrace("session_start", {
      label,
      startedAt: state.traceStartedAt
    });
  }

  function traceLogFilename(date = new Date()) {
    return `alchemy_trace_${date.toISOString().replaceAll(":", "-").replaceAll(".", "-")}.log`;
  }

  function buildTraceLogText() {
    const lines = [];
    lines.push(`# trace_session=${state.traceSessionId} started_at=${state.traceStartedAt || "n/a"}`);
    if (state.traceOverflowed) {
      lines.push("# trace_overflow=true");
    }
    for (const entry of state.traceEntries) {
      const fieldsText = Object.entries(entry.fields || {})
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ");
      lines.push(`${entry.at} [${entry.type}] ${fieldsText}`.trim());
    }
    return `${lines.join("\n")}\n`;
  }

  function downloadTraceLogs() {
    const blob = new Blob([buildTraceLogText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = traceLogFilename(new Date());
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return {
    truncateTraceField,
    normalizeTraceField,
    pushTrace,
    startTraceSession,
    traceLogFilename,
    buildTraceLogText,
    downloadTraceLogs
  };
}
