import { useParams } from "react-router";

export default function AdminRubricDetail() {
  const { id } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Rubric Detail</h1>
      <p className="text-gray-500 mt-1">Rubric: {id}</p>
    </div>
  );
}
