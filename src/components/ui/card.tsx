import * as React from "react"

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className="rounded-lg border bg-card text-card-foreground shadow-sm"
      {...props}
    />
  )
}

Card.displayName = "Card"

export function CardHeader({ className, ...props }: CardProps) {
  return <div className="flex flex-col space-y-1.5 p-6" {...props} />
}
CardHeader.displayName = "CardHeader"

export function CardTitle({ className, ...props }: CardProps) {
  return (
    <h3
      className="text-2xl font-semibold leading-none tracking-tight"
      {...props}
    />
  )
}
CardTitle.displayName = "CardTitle"

export function CardContent({ className, ...props }: CardProps) {
  return <div className="p-6 pt-0" {...props} />
}
CardContent.displayName = "CardContent"