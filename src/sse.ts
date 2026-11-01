// A minimal Server-Sent Events parser (WHATWG event-stream format): enough for Wikimedia EventStreams.
export interface SseEvent {
  id: string | null;
  event: string;
  data: string;
}

/** Feed it text chunks in order; it returns the events completed by each chunk. Handles \n, \r\n and \r line ends,
 * multi-line data, comments, and lines split across chunks. */
export class SseParser {
  private rest = "";
  private data: string[] = [];
  private event = "";
  private id: string | null = null;
  private sawCr = false;

  push(chunk: string): SseEvent[] {
    let text = chunk;
    // A \r at the end of the last chunk and a \n at the start of this one are one line end.
    if (this.sawCr && text.startsWith("\n")) text = text.slice(1);
    this.sawCr = text.endsWith("\r");
    const lines = (this.rest + text).split(/\r\n|\r|\n/);
    this.rest = lines.pop() ?? "";
    const out: SseEvent[] = [];
    for (const line of lines) {
      if (line === "") {
        if (this.data.length > 0) out.push({ id: this.id, event: this.event || "message", data: this.data.join("\n") });
        this.data = [];
        this.event = "";
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") this.data.push(value);
      else if (field === "event") this.event = value;
      else if (field === "id" && !value.includes("\0")) this.id = value;
    }
    return out;
  }
}
