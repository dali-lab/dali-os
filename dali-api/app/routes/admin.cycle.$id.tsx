import { useParams } from "react-router";

export default function AdminCycleDetails() {
  const { id } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Cycle Details</h1>
      <p className="text-gray-500 mt-1">Cycle: {id}</p>
    </div>
  );
}
