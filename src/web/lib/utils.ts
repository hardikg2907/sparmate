import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The app's type scale names would otherwise read as text colours, and a merge would drop the real colour.
const merge = extendTailwindMerge({
  extend: {
    theme: { text: ["meta", "ui", "body", "lead", "title", "display", "mega"] },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
