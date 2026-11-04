export const approveAllConfirm = (pending: number) => ({
  title: `Approve all ${pending} pending applicants?`,
  description:
    "Approves up to capacity and emails each approved applicant. Applicants beyond the seat limit stay pending.",
  confirmLabel: "Approve all",
});
