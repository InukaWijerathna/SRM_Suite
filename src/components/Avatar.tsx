import { useState } from 'react';
import type { ChildRecord } from '../types';
import { cn } from '../lib/cn';
import { initials } from '../lib/roster';
import { resolvePhotoUrl } from '../lib/photo';

const SIZES = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-12 w-12 text-base',
  lg: 'h-20 w-20 text-2xl',
} as const;

const TINT = {
  male: 'bg-sky-100 text-sky-700',
  female: 'bg-pink-100 text-pink-700',
  unknown: 'bg-slate-200 text-slate-600',
} as const;

interface AvatarProps {
  child: Pick<ChildRecord, 'fullName' | 'gender' | 'pictureRef'>;
  size?: keyof typeof SIZES;
  className?: string;
}

/** Student photo, or an initials circle when there is no photo or it fails to load. */
export function Avatar({ child, size = 'md', className }: AvatarProps) {
  const url = resolvePhotoUrl(child.pictureRef);
  const [failedUrl, setFailedUrl] = useState<string>();
  const showPhoto = url && failedUrl !== url;

  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        !showPhoto && TINT[child.gender],
        className,
      )}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        initials(child.fullName)
      )}
    </div>
  );
}
