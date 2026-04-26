interface AvatarProps {
  src?: string | null
  fallback: string
  size?: number
  className?: string
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://placeholder.invalid')
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function Avatar({ src, fallback, size = 32, className = '' }: AvatarProps) {
  if (src && isSafeUrl(src)) {
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
