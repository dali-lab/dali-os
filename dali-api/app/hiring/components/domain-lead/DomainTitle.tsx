import { useSearchParams } from "react-router";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";

export type DomainOption = { id: string; name: string };

export function DomainTitle({ domains, currentId }: { domains: DomainOption[]; currentId: string }) {
  const os = useOsChrome();
  const [, setSearchParams] = useSearchParams();
  const current = domains.find((d) => d.id === currentId);

  if (domains.length < 2) return <h1 className={os.pageTitle}>{current?.name}</h1>;

  const setDomain = (domainId: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("domain", domainId);
        next.delete("cycle");
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <h1 className={`${os.pageTitle} min-w-0`}>
      <Select
        ariaLabel="Domain"
        value={currentId}
        onChange={setDomain}
        options={domains.map((d) => ({ value: d.id, label: d.name }))}
        buttonClassName="-mx-2 max-w-full rounded-[10px] px-2 py-0.5 text-left hover:bg-os-hover"
      />
    </h1>
  );
}
