import { useState, useRef } from "react";

export function FileUploadField({
  value,
  onChange,
  accept,
  questionKey,
}: {
  value: string;
  onChange: (v: string) => void;
  accept?: string;
  questionKey: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileName = value ? value.split("/").pop() ?? "Uploaded file" : null;

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      // 1. Get presigned upload URL
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `applications/${questionKey}/${crypto.randomUUID()}-${file.name}`,
          contentType: file.type,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text();
        let message = "Failed to get upload URL";
        try { message = JSON.parse(text).error ?? message; } catch {}
        throw new Error(message);
      }
      const { uploadUrl, key } = await presignRes.json();

      // 2. Upload directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      // 3. Store the S3 key as the answer
      onChange(key);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  if (uploading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-500">
        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-accent-coral rounded-full animate-spin" />
        Uploading...
      </div>
    );
  }

  if (fileName) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white">
        <svg className="w-5 h-5 text-accent-coral shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-sm text-dark-blue truncate flex-1">{fileName}</span>
        <button
          type="button"
          onClick={() => { onChange(""); if (fileRef.current) fileRef.current.value = ""; }}
          className="text-xs text-gray-400 hover:text-red-500 transition"
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs text-accent-coral hover:text-accent-coral/80 transition"
        >
          Replace
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-gray-200 bg-white text-sm text-gray-500 hover:border-accent-coral hover:text-accent-coral transition w-full"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        Choose file to upload
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
