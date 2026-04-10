import { useParams } from "react-router";

export default function DomainLeadApplicationView() {
  const { id } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Application</h1>
      <p className="text-gray-500 mt-1">Application: {id}</p>
    </div>
  );
}
