import type { SurfaceComponentProps } from "@/sdk/react/types";

/** Props for the company's component implementations (reader output typed per component). */
export type HostComponentProps<D = unknown> = SurfaceComponentProps<D>;

export function setting<T extends string | number | boolean>(
  settings: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = settings[key];
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}
