import { useParams } from "react-router";

export default function MentorApplicationReview() {
  const { id } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Application Review</h1>
      <p className="text-gray-500 mt-1">Application: {id}</p>
    </div>
  );
}
