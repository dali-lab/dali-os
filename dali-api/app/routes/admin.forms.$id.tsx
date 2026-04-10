import { useParams } from "react-router";

export default function AdminFormDetail() {
  const { id } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Form Detail</h1>
      <p className="text-gray-500 mt-1">Form: {id}</p>
    </div>
  );
}
