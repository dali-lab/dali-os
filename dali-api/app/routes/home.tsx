import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "dali-api" },
    { name: "description", content: "DALI OS — API app" },
  ];
}

export default function Home() {
  return <Welcome />;
}
