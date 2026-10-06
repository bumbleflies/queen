export function Brand({ size = 28, className = 'brand' }: { size?: number; className?: string }) {
  return (
    <div className={className}>
      <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
        <path
          d="M14 2 25 8.5v11L14 26 3 19.5v-11Z"
          fill="#E0A100"
          stroke="#1B1B1F"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M9 12.5 11.5 15 14 11l2.5 4L19 12.5 18 18H10Z" fill="#1B1B1F" />
      </svg>
      <span>queen</span>
    </div>
  );
}
