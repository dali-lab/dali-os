import { redirect } from "react-router";

export function loader({ request, params }: { request: Request; params: { "*"?: string } }) {
  const rest = params["*"] ? `/${params["*"]}` : "";
  return redirect(`/community${rest}${new URL(request.url).search}`, 301);
}
