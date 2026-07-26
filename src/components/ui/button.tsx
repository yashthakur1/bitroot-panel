import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-[background-color,scale] active:scale-[0.96] disabled:active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-md text-sm",
  {
    variants: {
      variant: {
        default: "bg-black text-white hover:bg-black/90 active:bg-black/80",
        secondary: "border border-solid border-gray-300 bg-white text-gray-800 hover:bg-gray-50 active:bg-gray-100",
        destructive: "bg-red-600 text-white hover:bg-red-600/90 active:bg-red-700",
        outline: "border border-solid border-gray-300 bg-transparent hover:bg-gray-50 active:bg-gray-100",
        ghost: "hover:bg-gray-100 active:bg-gray-200",
        link: "text-blue-600 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 py-2 px-4",
        sm: "h-9 py-1.5 px-3 text-xs",
        lg: "h-11 py-2.5 px-5",
      },
      fullWidth: {
        true: "w-full",
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      fullWidth: false,
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
