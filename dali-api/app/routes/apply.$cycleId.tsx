import { useParams } from "react-router";

export default function ApplicationFormView() {
  const { cycleId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Apply</h1>
      <p className="text-gray-500 mt-1">Cycle: {cycleId}</p>
    </div>
  );
}
