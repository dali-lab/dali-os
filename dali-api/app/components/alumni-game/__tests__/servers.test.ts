import { describe, it, expect } from "vitest";
import { LAB_SERVERS, SERVER_CAPACITY, serverStatus, isLabServerId } from "../servers";

describe("lab servers", () => {
  it("has unique ids", () => {
    const ids = LAB_SERVERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isLabServerId(id)).toBe(true);
    expect(isLabServerId("lab-99")).toBe(false);
  });

  it("grades load: green when pretty empty, yellow when crowded, red at capacity", () => {
    expect(serverStatus(0)).toBe("open");
    expect(serverStatus(Math.ceil(SERVER_CAPACITY * 0.5) - 1)).toBe("open");
    expect(serverStatus(Math.ceil(SERVER_CAPACITY * 0.5))).toBe("busy");
    expect(serverStatus(SERVER_CAPACITY - 1)).toBe("busy");
    expect(serverStatus(SERVER_CAPACITY)).toBe("full");
  });
});
