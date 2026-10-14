import type { ChangeEvent, RefObject } from "react";

export function DriveUploadInput({
  inputRef,
  onChange,
  testId,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  testId?: string;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      className="sr-only"
      aria-hidden="true"
      tabIndex={-1}
      onChange={onChange}
      data-testid={testId}
    />
  );
}
