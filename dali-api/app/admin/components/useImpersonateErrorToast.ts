import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { IMPERSONATE_ERROR_PARAM, impersonateErrorMessage } from "~/admin/lib/impersonate-error";
import { useToast } from "~/components/ui/toast";

export function useImpersonateErrorToast(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const message = impersonateErrorMessage(searchParams.get(IMPERSONATE_ERROR_PARAM));

  useEffect(() => {
    if (!message) return;
    toast.error(message);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete(IMPERSONATE_ERROR_PARAM);
        return params;
      },
      { replace: true },
    );
  }, [message]);
}
