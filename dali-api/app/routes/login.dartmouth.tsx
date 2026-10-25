import { redirect } from "react-router";

// Old link target; Dartmouth sign-up happens on the /signup door.
export function loader() {
  return redirect("/signup?door=dartmouth");
}

export function action() {
  return redirect("/signup?door=dartmouth");
}
