/**
 * Accessible loading spinner. Screen readers get `role="status"` so the
 * "Loading…" label is announced; sighted users get the spinning ring.
 *
 *   <Spinner />                        — small inline, no text
 *   <Spinner size="md" label="…" />    — medium with announced label
 *   <Spinner center />                 — centred in a flex-grow container
 */

type SpinnerProps = {
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
  className?: string;
};

const SIZE: Record<NonNullable<SpinnerProps["size"]>, string> = {
  xs: "w-3 h-3 border-2",
  sm: "w-4 h-4 border-2",
  md: "w-6 h-6 border-2",
  lg: "w-8 h-8 border-[3px]",
};

export default function Spinner({
  size = "sm",
  label = "Loading",
  className = "",
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center ${className}`}
    >
      <span
        aria-hidden="true"
        className={`${SIZE[size]} inline-block rounded-full border-blue-600 border-t-transparent animate-spin`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
