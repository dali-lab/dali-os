import { useParams } from "react-router";

export default function ApplicationStatusView() {
  const { appId } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Application Status</h1>
      <p className="text-muted-foreground mt-1">Application: {appId}</p>
    </div>
  );
}
