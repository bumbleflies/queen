import { formatEUR } from '../lib/format';

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={`num${className ? ` ${className}` : ''}`}>{formatEUR(cents)}</span>;
}
