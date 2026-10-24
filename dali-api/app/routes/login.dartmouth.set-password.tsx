import { redirect } from "react-router";

// Old link target; finishing setup happens at /welcome.
export function loader() {
  return redirect("/welcome?door=dartmouth");
}
