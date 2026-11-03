import logos from "@/lib/brand/logos.json";

type LogoProps = {
  variant?: "wide" | "small";
  width?: number;
  className?: string;
  decorative?: boolean;
  appearance?: "theme" | "dark";
  x?: number;
  y?: number;
};

/** The two approved logos. Placement may change size, never the artwork. */
export function Logo({ variant = "wide", width, className, decorative = false, appearance = "theme", x, y }: LogoProps) {
  const artwork = logos[variant];
  const size = width ?? artwork.width;
  return <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={`0 0 ${artwork.width} ${artwork.height}`}
    width={size}
    height={size * artwork.height / artwork.width}
    x={x}
    y={y}
    className={["brand-logo", className].filter(Boolean).join(" ")}
    data-logo={variant}
    role={decorative ? undefined : "img"}
    aria-label={decorative ? undefined : "kopes.ai"}
    aria-hidden={decorative || undefined}
    focusable="false"
  >
    <path d={artwork.main} fill={appearance === "dark" ? "#E8E8E3" : "var(--ink)"}/>
    {artwork.accent && <path d={artwork.accent} fill={appearance === "dark" ? "#C6F24E" : "var(--brand-ink)"}/>}
    <rect {...artwork.cursor} fill={appearance === "dark" ? "#C6F24E" : "var(--brand)"}/>
  </svg>;
}
