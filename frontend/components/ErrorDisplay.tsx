import { memo } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

interface ErrorDisplayProps {
    error: string
}

function ErrorDisplayComponent({ error }: ErrorDisplayProps) {
    return (
        <Alert variant="destructive" className="py-12">
            <AlertCircle className="!size-10 mx-auto mb-4" />
            <AlertTitle className="text-center text-lg">Playback Error</AlertTitle>
            <AlertDescription className="text-center max-w-lg mx-auto">
                {error}
            </AlertDescription>
        </Alert>
    )
}

export const ErrorDisplay = memo(ErrorDisplayComponent)
