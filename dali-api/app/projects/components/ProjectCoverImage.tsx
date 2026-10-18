// Shared project cover / card image. When `imageUrl` is missing, render the
// same coral→green gradient + initial used by ProjectImageBanner so list and
// partner cards don't collapse to a title-only block.

export function ProjectCoverImage({
  name,
  imageUrl,
  className = "w-full h-28 object-cover",
  placeholderClassName = "w-full h-28",
}: {
  name: string;
  imageUrl: string | null | undefined;
  className?: string;
  placeholderClassName?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (imageUrl) {
    return <img src={imageUrl} alt="" className={className} />;
  }

  return (
    <div
      className={`${placeholderClassName} bg-gradient-to-br from-os-accent/30 via-os-accent/15 to-os-green/20 flex items-center justify-center border-b border-border`}
      aria-hidden
    >
      <span className="font-heading font-bold text-3xl text-os-accent/70">
        {initial}
      </span>
    </div>
  );
}
