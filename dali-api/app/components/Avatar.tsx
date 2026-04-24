interface AvatarProps {
  src?: string | null
  fallback: string
  size?: number
  className?: string
}

export function Avatar({ src, fallback, size = 32, className = '' }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={`rounded-full bg-accent-coral text-white flex items-center justify-center font-bold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.375 }}
    >
      {fallback}
    </div>
  )
}
