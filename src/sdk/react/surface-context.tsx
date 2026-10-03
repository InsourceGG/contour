"use client";

import { createContext, useContext } from "react";
import type { SurfaceChrome } from "./types";

export const SurfaceChromeContext = createContext<SurfaceChrome>({ preview: false, density: "comfortable" });

export function useSurfaceChrome(): SurfaceChrome {
  return useContext(SurfaceChromeContext);
}
