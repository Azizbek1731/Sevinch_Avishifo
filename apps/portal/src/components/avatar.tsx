import { API_URL } from '@/lib/api';

export function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** Photo URLs may come absolute or relative to the API host. */
export function resolveAssetUrl(url: string): string {
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}

interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: 'md' | 'lg';
}

/** Photo with colored-initials fallback. */
export function Avatar({ name, photoUrl, size = 'lg' }: AvatarProps) {
  const sizeClass = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-10 w-10 text-sm';
  if (photoUrl !== undefined && photoUrl !== null && photoUrl !== '') {
    return (
      <img
        src={resolveAssetUrl(photoUrl)}
        alt={name}
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${sizeClass} flex items-center justify-center rounded-full bg-brand-light font-semibold text-brand-dark`}
    >
      {initialsOf(name)}
    </span>
  );
}
