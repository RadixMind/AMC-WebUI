import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';

export const DropdownMenu = DropdownMenuPrimitive.Root;

export const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ onClick, onPointerDown, ...props }, ref) => {
  const hasPointerDown = React.useRef(false);

  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      onPointerDown={(event) => {
        hasPointerDown.current = true;
        onPointerDown?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!hasPointerDown.current && !event.defaultPrevented) {
          const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
          event.currentTarget.dispatchEvent(
            new EventCtor('pointerdown', {
              bubbles: true,
              cancelable: true,
              button: 0,
            }),
          );
        }
        hasPointerDown.current = false;
      }}
      {...props}
    />
  );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
};

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  DropdownMenuSubTriggerProps
>(({ className = '', inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={`flex cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none text-[var(--theme-text-primary)] transition-colors data-[state=open]:bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-tertiary)] focus:bg-[var(--theme-bg-tertiary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${
      inset ? 'pl-8' : ''
    } ${className}`}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-3.5 w-3.5 text-[var(--theme-text-tertiary)]" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

export type DropdownMenuSubContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>;

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  DropdownMenuSubContentProps
>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      collisionPadding={8}
      className={`z-[9999] min-w-[9rem] overflow-hidden rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] p-1 text-[var(--theme-text-primary)] shadow-xl animate-in fade-in zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 backdrop-blur-md ${className}`}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

export interface DropdownMenuContentProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  portalled?: boolean;
}

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(({ className = '', sideOffset = 4, portalled = true, ...props }, ref) => {
  const content = (
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={`z-[9999] min-w-[11rem] overflow-hidden rounded-xl border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] p-1 text-[var(--theme-text-primary)] shadow-xl animate-in fade-in zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 backdrop-blur-md ${className}`}
      {...props}
    />
  );

  return portalled ? <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal> : content;
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'danger';
};

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className = '', inset, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={`relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${
      variant === 'danger'
        ? 'text-[var(--theme-icon-error)] hover:bg-[var(--theme-bg-danger)] hover:text-[var(--theme-text-accent)] focus:bg-[var(--theme-bg-danger)] focus:text-[var(--theme-text-accent)]'
        : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] focus:bg-[var(--theme-bg-tertiary)]'
    } ${inset ? 'pl-8' : ''} ${className}`}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>;

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuSeparatorProps
>(({ className = '', ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={`my-1 -mx-1 h-px bg-[var(--theme-border-secondary)] ${className}`}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export const DropdownMenuShortcut = ({ className = '', ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={`ml-auto text-[10px] tracking-widest text-[var(--theme-text-tertiary)] font-mono opacity-70 ${className}`}
      {...props}
    />
  );
};
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';
