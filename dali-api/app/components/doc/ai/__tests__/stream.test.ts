// Unit tests for parseSseEvents in stream.ts.
// Pure function — no DOM or network required.

import { describe, it, expect } from "vitest";
import { parseSseEvents } from "../stream";

describe("parseSseEvents", () => {
  it("returns empty events and original buffer for no complete events", () => {
    const { events, rest } = parseSseEvents("data: hello");
    expect(events).toHaveLength(0);
    expect(rest).toBe("data: hello");
  });

  it("parses a single complete event", () => {
    const { events, rest } = parseSseEvents('data: {"delta":"hi"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"delta":"hi"}');
    expect(rest).toBe("");
  });

  it("parses multiple events in one chunk", () => {
    const buf = 'data: {"delta":"a"}\n\ndata: {"delta":"b"}\n\n';
    const { events, rest } = parseSseEvents(buf);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe('{"delta":"a"}');
    expect(events[1].data).toBe('{"delta":"b"}');
    expect(rest).toBe("");
  });

  it("keeps incomplete last event as rest", () => {
    const buf = 'data: {"delta":"a"}\n\ndata: {"delta":"b"}';
    const { events, rest } = parseSseEvents(buf);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"delta":"a"}');
    expect(rest).toBe('data: {"delta":"b"}');
  });

  it("handles done event", () => {
    const { events } = parseSseEvents('data: {"done":true}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"done":true}');
  });

  it("handles error event", () => {
    const { events } = parseSseEvents('data: {"error":"oops"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"error":"oops"}');
  });

  it("ignores non-data lines (id:, event:, comments)", () => {
    const buf = "id: 1\nevent: message\ndata: hello\n\n";
    const { events } = parseSseEvents(buf);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("handles multi-line events (multiple data: lines in one block)", () => {
    // SSE spec: multiple data: lines concatenate, but we emit one event per line.
    const buf = "data: line1\ndata: line2\n\n";
    const { events } = parseSseEvents(buf);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("line1");
    expect(events[1].data).toBe("line2");
  });

  it("handles empty buffer", () => {
    const { events, rest } = parseSseEvents("");
    expect(events).toHaveLength(0);
    expect(rest).toBe("");
  });

  it("handles a buffer with only \\n\\n (empty event)", () => {
    const { events, rest } = parseSseEvents("\n\n");
    // Empty block between \n\n — no data: lines, so no events
    expect(events).toHaveLength(0);
    expect(rest).toBe("");
  });

  it("simulates split-across-chunks by calling twice", () => {
    // First chunk: partial
    const chunk1 = 'data: {"delta"';
    const { events: e1, rest: r1 } = parseSseEvents(chunk1);
    expect(e1).toHaveLength(0);
    expect(r1).toBe(chunk1);

    // Second chunk: completes the event
    const chunk2 = r1 + ':"hi"}\n\n';
    const { events: e2, rest: r2 } = parseSseEvents(chunk2);
    expect(e2).toHaveLength(1);
    expect(e2[0].data).toBe('{"delta":"hi"}');
    expect(r2).toBe("");
  });

  it("handles multiple events with partial tail across simulated chunks", () => {
    const chunk1 = 'data: {"delta":"a"}\n\ndata: {"del';
    const { events: e1, rest: r1 } = parseSseEvents(chunk1);
    expect(e1).toHaveLength(1);
    expect(r1).toBe('data: {"del');

    const chunk2 = r1 + 'ta":"b"}\n\n';
    const { events: e2 } = parseSseEvents(chunk2);
    expect(e2).toHaveLength(1);
    expect(e2[0].data).toBe('{"delta":"b"}');
  });
});
