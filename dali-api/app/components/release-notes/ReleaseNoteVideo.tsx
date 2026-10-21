export function ReleaseNoteVideo({ src, title }: { src: string; title: string }) {
  return (
    <video
      src={src}
      controls
      preload="metadata"
      playsInline
      aria-label={`Demo: ${title}`}
      className="w-full rounded-md bg-black"
    />
  );
}
