const PHOTO_BASE = (import.meta.env.VITE_PHOTO_BASE_URL ?? '').replace(/\/+$/, '');

const DRIVE_ID = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/;

/**
 * Turns a `picture_ref` into an <img> URL, or undefined when there is nothing loadable
 * (the UI then falls back to an initials avatar).
 * Accepts Google Drive share links, plain https URLs, or bare filenames + VITE_PHOTO_BASE_URL.
 */
export function resolvePhotoUrl(ref?: string): string | undefined {
  const value = ref?.trim();
  if (!value) return undefined;

  const drive = value.match(DRIVE_ID);
  if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w400`;
  if (/^https?:\/\//i.test(value)) return value;
  return PHOTO_BASE ? `${PHOTO_BASE}/${encodeURIComponent(value)}` : undefined;
}
