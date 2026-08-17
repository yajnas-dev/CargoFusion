/**
 * Shared icon set — replaces the emoji (⚓🏗️🚚🤖📖🔔⚠️✅) that were
 * standing in for real iconography. Geometric, stroke-based, minimal:
 * instrumentation marks, not illustrations. Every icon takes the same
 * size/className props and renders at 1em by default so it sits inline
 * with text at whatever font-size the caller is using.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function AnchorIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="5" r="2.25" />
      <path d="M12 7.25V21" />
      <path d="M6.5 14a5.5 5.5 0 0 0 11 0" />
      <path d="M4 14h2.5M17.5 14H20" />
      <path d="M8.5 10.5 12 12.5l3.5-2" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 10.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14.5 6 10.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function GridMapIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="6" height="6" rx="0.5" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="0.5" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="0.5" />
      <rect x="14.5" y="14.5" width="6" height="6" rx="0.5" />
      <path d="M9.5 6.5h5M9.5 17.5h5M6.5 9.5v5M17.5 9.5v5" />
    </svg>
  );
}

export function AgentNodeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="17" r="2" />
      <circle cx="19" cy="17" r="2" />
      <path d="M10.5 6.5 6.5 15M13.5 6.5l4 8.5M7 17h10" />
    </svg>
  );
}

export function CraneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 21V9l6-5 6 5" />
      <path d="M6 9h13" />
      <path d="M17 9v4" />
      <path d="M3 21h18" />
      <path d="M9 21v-6M13 21v-6" />
    </svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="8" width="11" height="8" rx="0.5" />
      <path d="M13.5 11h4l3 3v2h-7z" />
      <circle cx="7" cy="18" r="1.75" />
      <circle cx="16.5" cy="18" r="1.75" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.25 2" />
    </svg>
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 21.5 20h-19Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.25" r="0.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
