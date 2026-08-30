/**
 * Travendiq védjegy – iránytű-jel + wordmark.
 * A jel: lekerekített mélytürkiz négyzetben egy iránytűtű (észak-kelet felé),
 * alatta a világegyenlítőt jelképező ív; a wordmark "q" betűjének pontja
 * a naplemente-korall akcentus.
 */
export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0">
        <rect width="32" height="32" rx="9" fill="#0f4c49" />
        <rect x="1" y="1" width="30" height="30" rx="8" stroke="#26978f" strokeOpacity="0.5" strokeWidth="1" />
        {/* iránytűtű */}
        <path d="M21.5 10.5 14.8 14.8l-4.3 6.7 6.7-4.3 4.3-6.7Z" fill="#fff" />
        <path d="M21.5 10.5 14.8 14.8l-1.2 1.2 3.1 3.1 4.8-8.5Z" fill="#f2682f" />
        <circle cx="16" cy="16" r="1.1" fill="#0f4c49" />
        {/* egyenlítő-ív */}
        <path d="M8 24.5c2.6 1.6 5.2 2.4 8 2.4s5.4-.8 8-2.4" stroke="#7ccfc7" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className={`text-[22px] font-extrabold tracking-tight ${light ? "text-white" : "text-ink-950"}`}>
        travendiq<span className="text-coral-500">.</span>
      </span>
    </span>
  );
}
