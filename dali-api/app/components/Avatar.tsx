interface AvatarProps {
  src?: string | null
  fallback: string
  size?: number
  className?: string
}

function sanitizeImageUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:') {
      return parsed.href
    }
    return null
  } catch {
    return null
  }
}

export function Avatar({ src, fallback, size = 32, className = '' }: AvatarProps) {
  const safeSrc = src ? sanitizeImageUrl(src) : null
  if (safeSrc) {
    return (
      <img
        src={safeSrc}
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
