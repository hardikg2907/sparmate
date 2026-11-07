import { useEffect, useState } from "react";

/** True only after `flag` has stayed true for `ms`, so a blink of a state does not flash a banner. */
export function useDelayed(flag: boolean, ms: number): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!flag) {
      setValue(false);
      return;
    }
    const timer = setTimeout(() => setValue(true), ms);
    return () => clearTimeout(timer);
  }, [flag, ms]);
  return value;
}
