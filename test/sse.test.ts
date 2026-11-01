import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse.ts";

describe("SseParser", () => {
  it("returns events with their id, joining multi-line data", () => {
    const p = new SseParser();
    expect(p.push('event: message\nid: [{"t":1}]\ndata: {"a":\ndata: 1}\n\n')).toEqual([{ id: '[{"t":1}]', event: "message", data: '{"a":\n1}' }]);
  });

  it("keeps a line split across chunks, and \\r\\n split between them", () => {
    const p = new SseParser();
    expect(p.push("data: hel")).toEqual([]);
    expect(p.push("lo\r")).toEqual([]);
    expect(p.push("\n\r\n")).toEqual([{ id: null, event: "message", data: "hello" }]);
  });

  it("skips comments and blank events, and keeps the last id for later events", () => {
    const p = new SseParser();
    expect(p.push(":ok\n\nid: 7\n\ndata: x\n\n")).toEqual([{ id: "7", event: "message", data: "x" }]);
  });
});
