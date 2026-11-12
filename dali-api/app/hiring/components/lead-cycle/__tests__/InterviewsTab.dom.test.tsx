// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const { confirm, toastError } = vi.hoisted(() => ({ confirm: vi.fn(), toastError: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }) }));
vi.mock("~/hiring/components/ConfidentialityGate", () => ({ ConfidentialityGate: () => <div data-testid="gate" /> }));

import { act } from "react";
import { MemoryRouter } from "react-router";
import { renderDom, getButton } from "~/test-utils/render";
import { InterviewsTab } from "../InterviewsTab";

type Props = Parameters<typeof InterviewsTab>[0];

const future = new Date(Date.now() + 3 * 86_400_000);
const interview = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  startTime: future.toISOString(),
  endTime: new Date(future.getTime() + 1_800_000).toISOString(),
  status: "Scheduled",
  availability: {},
  room: null,
  zoomJoinUrl: null,
  videoUrl: null,
  domainApplication: { id: "da1", domainId: "d1", domain: { name: "Design" }, application: { user: { firstName: "Ada", lastName: "Lovelace" } } },
  assignments: [],
  ...over,
});

const loadInterviews = vi.fn();

function mount({ interviewers = [] as unknown[], interviews = [interview()], pendingInvites = [] as unknown[], confidentialityRequired = null as string | null, hiringEmails = {} as Record<string, unknown> } = {}) {
  const state = {
    config: { slotDurationMinutes: 30, bufferMinutes: 15, dayStartHour: 9, dayEndHour: 18, interviewStartDate: "", interviewEndDate: "", rescheduleNoticeHours: 12, cancelNoticeHours: 0, bookingNoticeHours: 12, timezone: "America/New_York", roomIds: [], holdRooms: false },
    setConfig: vi.fn(),
    configSaved: false,
    configSaving: false,
    availableRooms: [],
    holdConflicts: null,
    interviewers,
    interviews,
    setInterviews: vi.fn(),
    pendingInvites,
    coverage: null,
    loadInterviews,
    loadInterviewers: vi.fn(),
    loadCoverage: vi.fn(),
    saveConfig: vi.fn(),
    keepTheirBookings: vi.fn(),
  } as unknown as Props["state"];
  const data = { confidentialityRequired, hiringEmails } as unknown as Props["data"];
  return renderDom(
    <MemoryRouter>
      <InterviewsTab data={data} cycleId="c1" tab="interviews" state={state} />
    </MemoryRouter>,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("InterviewsTab", () => {
  it("renders the schedule card with the applicant and their interview", () => {
    const { container } = mount();
    expect(container.textContent).toContain("Interview schedule");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Design");
    expect(container.textContent).toContain("1 applicant.");
  });

  it("replaces the schedule with the confidentiality gate until the agreement is signed", () => {
    const { container } = mount({ confidentialityRequired: "unsigned" });
    expect(container.querySelector('[data-testid="gate"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Ada Lovelace");
  });

  it("cancels an interview through the cancel endpoint and refetches", async () => {
    confirm.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const { container } = mount();
    await act(async () => getButton(container, "Cancel interview").click());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hiring/interviews/i1/cancel",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ notifyApplicant: true }) }),
    );
    expect(loadInterviews).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the cancel confirm is dismissed", async () => {
    confirm.mockResolvedValue(false);
    const { container } = mount();
    await act(async () => getButton(container, "Cancel interview").click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadInterviews).not.toHaveBeenCalled();
  });

  it("toasts the server error and skips the refetch when cancelling is refused", async () => {
    confirm.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Too late to cancel" }) });
    const { container } = mount();
    await act(async () => getButton(container, "Cancel interview").click());
    expect(toastError).toHaveBeenCalledWith("Too late to cancel");
    expect(loadInterviews).not.toHaveBeenCalled();
  });

  it("offers no cancel button for a past interview", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const { container } = mount({ interviews: [interview({ startTime: past })] });
    expect(container.textContent).not.toContain("Cancel interview");
  });

  it("disables resend until the invite reminder email is written", () => {
    const pending = [{ id: "p1", invitedAt: new Date().toISOString(), withdrawn: false, domainApplication: { id: "da2", domain: { name: "Web" }, application: { user: { id: "u2", firstName: "Grace", lastName: "Hopper" } } } }];
    const without = mount({ interviews: [], pendingInvites: pending });
    expect(getButton(without.container, "Resend invite").disabled).toBe(true);
    without.unmount();
    const bound = mount({ interviews: [], pendingInvites: pending, hiringEmails: { "notification:InterviewInviteReminder": { subject: "s", body: "b" } } });
    expect(getButton(bound.container, "Resend invite").disabled).toBe(false);
  });

  it("toasts the server error when a reassignment is refused", async () => {
    confirm.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Interviewer is already booked" }) });
    const seated = { id: "a1", role: "InDomain", status: "Active", cycleInterviewer: { userId: "u1", user: { firstName: "Alan", lastName: "Turing", daliEmail: null }, domain: { name: "Design" } } };
    const pool = [
      { id: "ci1", userId: "u1", domainId: "d1", user: { firstName: "Alan", lastName: "Turing", daliEmail: null }, domain: { id: "d1", name: "Design" } },
      { id: "ci2", userId: "u2", domainId: "d1", user: { firstName: "Edsger", lastName: "Dijkstra", daliEmail: null }, domain: { id: "d1", name: "Design" } },
    ];
    const { container } = mount({
      interviewers: pool,
      interviews: [interview({ assignments: [seated], availability: { u2: "free" } })],
    });
    await act(async () => (container.querySelector('[aria-label="Reassign in-domain interviewer"]') as HTMLElement).click());
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes("Edsger Dijkstra")) as HTMLElement;
    await act(async () => option.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/hiring/interviews/i1/reassign", expect.objectContaining({ method: "POST" }));
    expect(toastError).toHaveBeenCalledWith("Interviewer is already booked");
  });
});
