import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/s3", () => ({ getObjectBytes: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getObjectBytes } from "~/lib/s3";
import { loader } from "~/routes/api.whiteboard.image";

function get(key: string) {
  const url = `http://localhost/api/whiteboard/image?key=${encodeURIComponent(key)}`;
  return loader({ request: new Request(url) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(getObjectBytes).mockResolvedValue({ body: Buffer.from("png"), contentType: "image/png" });
});

describe("GET /api/whiteboard/image", () => {
  it("serves a whiteboard image same-origin", async () => {
    const res = await get("uploads/whiteboard-images/uuid-shape.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(getObjectBytes).toHaveBeenCalledWith("uploads/whiteboard-images/uuid-shape.png");
  });

  it.each([
    "uploads/drive-files/uuid-dataset.zip",
    "uploads/project-files/p1/uuid-recording.mp4",
    "uploads/whiteboard-images/../drive-files/uuid-dataset.zip",
    "whiteboard-images/uuid-shape.png",
  ])("won't read %s into memory", async (key) => {
    const res = await get(key);
    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = await get("uploads/whiteboard-images/uuid-shape.png");
    expect(res.status).toBe(401);
  });
});
