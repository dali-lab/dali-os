import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "dali-web" },
    { name: "description", content: "DALI OS — Web app" },
  ];
}

export default function Home() {
  return <Welcome />;
}
