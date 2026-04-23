import { useParams } from "react-router";

export default function ApplicationFormView() {
  const { cycleId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Apply</h1>
      <p className="text-muted-foreground mt-1">Cycle: {cycleId}</p>
    </div>
  );
}
