import { useParams } from "react-router";

export default function AdminChallengeDetail() {
  const { id } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Challenge Detail</h1>
      <p className="text-gray-500 mt-1">Challenge: {id}</p>
    </div>
  );
}
