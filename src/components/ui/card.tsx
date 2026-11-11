import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type DivProps = HTMLAttributes<HTMLDivElement>;

/**
 * Simple presentational card pieces. Each renders a plain element with the
 * standard shadcn-style padding/typography applied on top of caller classes.
 */

const Card = forwardRef<HTMLDivElement, DivProps>(function Card(
  { className, ...rest },
  forwardedRef
) {
  return (
    <div
      ref={forwardedRef}
      className={cn("bg-card text-card-foreground border", className)}
      {...rest}
    />
  );
});

const CardHeader = forwardRef<HTMLDivElement, DivProps>(function CardHeader(
  { className, ...rest },
  forwardedRef
) {
  return (
    <div
      ref={forwardedRef}
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...rest}
    />
  );
});

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...rest }, forwardedRef) {
    return (
      <h3
        ref={forwardedRef}
        className={cn("text-lg font-semibold leading-none tracking-tight", className)}
        {...rest}
      />
    );
  }
);

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...rest }, forwardedRef) {
    return (
      <p
        ref={forwardedRef}
        className={cn("text-sm text-muted-foreground", className)}
        {...rest}
      />
    );
  }
);

const CardContent = forwardRef<HTMLDivElement, DivProps>(function CardContent(
  { className, ...rest },
  forwardedRef
) {
  return <div ref={forwardedRef} className={cn("p-6 pt-0", className)} {...rest} />;
});

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
