import { useEffect } from "react";

export default function Redirect() {
  useEffect(() => {
    window.location.href = "https://dali.dartmouth.edu";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <p className="text-gray-600">Redirecting to DALI homepage...</p>
      </div>
    </div>
  );
}