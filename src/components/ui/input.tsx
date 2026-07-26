import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "h-10 w-full m-0 py-2 px-3 bg-white dark:bg-gray-900 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:outline focus:outline-2 border border-solid rounded-md appearance-none text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 text-sm transition-colors",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
