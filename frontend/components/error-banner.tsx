import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface ErrorBannerProps {
  title?: string
  message: string
}

export function ErrorBanner({ title = "Something went wrong", message }: ErrorBannerProps) {
  return (
    <Alert variant="destructive" className="mb-6 rounded-md">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
