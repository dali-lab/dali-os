import { redirect } from "react-router";

// The internal applicant portal moved from /intern-to-full to /fellowship when
// the InternToFull cycle type was renamed to Fellowship. Old notification and
// task links still point here, so redirect them permanently.
export function loader() {
  return redirect("/fellowship", 301);
}

export default function InternToFullLegacyRedirect() {
  return null;
}
