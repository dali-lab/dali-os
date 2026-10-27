import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/realtime-bus.server", () => ({ publish: vi.fn() }));

import { publish } from "~/lib/realtime-bus.server";
import { notificationTopic, publishNotificationChange } from "~/lib/notify-stream.server";
import { commentTopic, publishCommentChange } from "~/lib/comment-events.server";
import { activityTopic, publishActivityChange } from "~/lib/activity-events.server";
import { publishCycleChange, staffingTopic } from "~/projects/lib/staffing-events.server";
import { delibsTopic, publishDelibsChange } from "~/hiring/lib/delibs-events.server";

beforeEach(() => vi.clearAllMocks());

describe("bus topics", () => {
  it("namespaces each surface so ids from different tables can't collide", () => {
    const topics = [
      notificationTopic("x"),
      commentTopic("x"),
      activityTopic("x"),
      staffingTopic("x"),
      delibsTopic("x"),
    ];
    expect(topics).toEqual(["notify:x", "comments:x", "activity:x", "staffing:x", "delibs:x"]);
  });

  it("publishes one notification topic per distinct user", () => {
    publishNotificationChange(["u1", "u2", "u1"]);
    expect(vi.mocked(publish).mock.calls).toEqual([["notify:u1"], ["notify:u2"]]);
  });

  it("publishes nothing for an empty user list", () => {
    publishNotificationChange([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["comments", () => publishCommentChange("p1"), "comments:p1"],
    ["activity", () => publishActivityChange("a1"), "activity:a1"],
    ["staffing", () => publishCycleChange("c1"), "staffing:c1"],
    ["delibs", () => publishDelibsChange("c1"), "delibs:c1"],
  ])("%s publishes its topic", (_name, run, topic) => {
    run();
    expect(publish).toHaveBeenCalledExactlyOnceWith(topic);
  });
});
