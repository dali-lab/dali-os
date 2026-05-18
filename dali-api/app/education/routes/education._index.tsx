import { redirect } from "react-router";

export async function loader() {
  return redirect("/education/browse");
}

export default function EducationIndex() {
  return null;
}
