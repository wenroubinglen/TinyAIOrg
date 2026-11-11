"use client"

import { cn } from "@/lib/utils"
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom"

type DivAttrs = React.HTMLAttributes<HTMLDivElement>

export type ChatContainerRootProps = {
  children: React.ReactNode
  className?: string
  /** Exposes the StickToBottom context so parents can read isAtBottom / call scrollToBottom. */
  contextRef?: React.Ref<StickToBottomContext>
} & DivAttrs

export type ChatContainerContentProps = {
  children: React.ReactNode
  className?: string
} & DivAttrs

export type ChatContainerScrollAnchorProps = {
  className?: string
  ref?: React.RefObject<HTMLDivElement>
} & DivAttrs

// Scroll-termination marker: a 1px invisible div the scroller pins to.
function ChatContainerScrollAnchor({
  className,
  ...rest
}: ChatContainerScrollAnchorProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-px w-full shrink-0 scroll-mt-4", className)}
      {...rest}
    />
  )
}

// Vertical column of messages; StickToBottom keeps it pinned to the newest content.
function ChatContainerRoot({
  children,
  className,
  ...rest
}: ChatContainerRootProps) {
  return (
    <StickToBottom
      role="log"
      resize="smooth"
      initial="instant"
      className={cn("flex overflow-y-auto", className)}
      {...rest}
    >
      {children}
    </StickToBottom>
  )
}

function ChatContainerContent({
  children,
  className,
  ...rest
}: ChatContainerContentProps) {
  return (
    <StickToBottom.Content
      className={cn("flex w-full flex-col", className)}
      {...rest}
    >
      {children}
    </StickToBottom.Content>
  )
}

export { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor }
