import * as React from "react";

import { cn } from "@/lib/utils";

export const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { maxHeightClassName?: string }
>(({ className, maxHeightClassName, ...props }, ref) => {
  return (
    <div
      className={cn("overflow-auto", maxHeightClassName, className)}
      ref={ref}
      {...props}
    />
  );
});
ScrollArea.displayName = "ScrollArea";
