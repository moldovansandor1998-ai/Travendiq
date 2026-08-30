"use client";

import { useState } from "react";

const FALLBACK = "/images/listing-fallback.svg";

/**
 * Törött-kép-biztos <img>: ha a forrás nem tölthető be (404, hálózat,
 * törölt storage-objektum), a helyi fallback képre vált. Az alt szöveg
 * kötelező – a listing címe.
 */
export function SafeImage({ src, alt, className, eager }: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const finalSrc = broken || !src ? FALLBACK : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={finalSrc}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      onError={() => setBroken(true)}
    />
  );
}
