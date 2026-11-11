"use client";

/**
 * Compound chat-style prompt box. `PromptInput` owns the text state (controlled
 * or uncontrolled), and the subcomponents read it through context.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PromptInputContextValue = {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
};

const PromptInputContext = createContext<PromptInputContextValue>({
  isLoading: false,
  value: "",
  setValue: () => {},
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
  textareaRef: React.createRef<HTMLTextAreaElement>(),
});

/** Access the enclosing PromptInput's state from custom subcomponents. */
function usePromptInput() {
  return useContext(PromptInputContext);
}

export type PromptInputProps = {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
} & React.ComponentProps<"div">;

function PromptInput({
  className,
  isLoading = false,
  maxHeight = 240,
  value,
  onValueChange,
  onSubmit,
  children,
  disabled = false,
  onClick,
  ...rest
}: PromptInputProps) {
  // Keeps uncontrolled usage working; ignored when `value` is provided.
  const [uncontrolledValue, setUncontrolledValue] = useState(value ?? "");

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const storeValue = onValueChange ?? setUncontrolledValue;

  const handleRootClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!disabled) textareaRef.current?.focus();
    onClick?.(event);
  };

  const ctx: PromptInputContextValue = {
    isLoading,
    value: value ?? uncontrolledValue,
    setValue: storeValue,
    maxHeight,
    onSubmit,
    disabled,
    textareaRef,
  };

  return (
    <TooltipProvider>
      <PromptInputContext.Provider value={ctx}>
        <div
          onClick={handleRootClick}
          className={cn(
            "border-input bg-background cursor-text rounded-3xl border p-1.5 shadow-xs",
            disabled && "cursor-not-allowed opacity-60",
            className
          )}
          {...rest}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  );
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean;
} & React.ComponentProps<typeof Textarea>;

/** Grow-to-fit textarea; Enter submits, Shift+Enter inserts a newline. */
function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  ...rest
}: PromptInputTextareaProps) {
  const { value, setValue, maxHeight, onSubmit, disabled, textareaRef } =
    usePromptInput();

  /** Reset then re-measure so the textarea shrinks when text is removed. */
  const fitToContent = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el || disableAutosize) return;
      el.style.height = "auto";
      el.style.height =
        typeof maxHeight === "number"
          ? `${Math.min(el.scrollHeight, maxHeight)}px`
          : `min(${el.scrollHeight}px, ${maxHeight})`;
    },
    [disableAutosize, maxHeight]
  );

  const attachRef = (el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    fitToContent(el);
  };

  useLayoutEffect(() => {
    fitToContent(textareaRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, maxHeight, disableAutosize]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    fitToContent(event.target);
    setValue(event.target.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(event);
  };

  return (
    <Textarea
      ref={attachRef}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      className={cn(
        "text-primary min-h-[44px] w-full resize-none border-none bg-transparent shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent",
        className
      )}
      rows={1}
      disabled={disabled}
      {...rest}
    />
  );
}

export type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>;

/** Row container for toolbar buttons beneath/next to the textarea. */
function PromptInputActions({ children, className, ...rest }: PromptInputActionsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...rest}>
      {children}
    </div>
  );
}

export type PromptInputActionProps = {
  className?: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
} & React.ComponentProps<typeof Tooltip>;

/** Wraps any control in a tooltip; clicks don't steal focus from the textarea. */
function PromptInputAction({
  tooltip,
  children,
  className,
  side = "top",
  ...rest
}: PromptInputActionProps) {
  const { disabled } = usePromptInput();

  return (
    <Tooltip {...rest}>
      <TooltipTrigger
        asChild
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction };
