import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap uppercase text-caption font-semibold tracking-[0.05em] ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
  {
    variants: {
      variant: {
        default:
          'btn-gradient-primary text-white rounded-md px-6 py-3 min-h-[44px] shadow-glow hover:brightness-110 hover:-translate-y-0.5',
        destructive:
          'btn-gradient-danger text-white rounded-md px-6 py-3 min-h-[44px] shadow-glow hover:brightness-110 hover:-translate-y-0.5',
        outline:
          'glass text-primary rounded-md px-6 py-3 min-h-[44px] hover:bg-primary/10 hover:-translate-y-0.5',
        secondary:
          'glass text-foreground rounded-md px-6 py-3 min-h-[44px] hover:-translate-y-0.5',
        ghost: 'rounded-md hover:bg-muted text-foreground normal-case tracking-normal font-medium',
        link: 'text-primary underline-offset-4 hover:underline rounded-none px-0 py-0 normal-case tracking-normal font-medium',
        glass: 'glass text-foreground rounded-md px-6 py-3 min-h-[44px] hover:-translate-y-0.5',
      },
      size: {
        default: 'h-auto min-h-[44px]',
        sm: 'min-h-9 text-fine-print px-4 py-2',
        lg: 'min-h-[48px] text-body px-8 py-3',
        icon: 'h-11 w-11 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
