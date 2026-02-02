import { memo } from 'react'

interface ErrorDisplayProps {
    error: string
}

function ErrorDisplayComponent({ error }: ErrorDisplayProps) {
    return (
        <div
            style={{
                padding: '3rem 2rem',
                background: '#fee2e2',
                borderRadius: '8px',
                border: '1px solid #fecaca',
                textAlign: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
        >
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
            <div style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.75rem', color: '#991b1b' }}>
                Playback Error
            </div>
            <div style={{
                fontSize: '0.9375rem',
                color: '#7f1d1d',
                maxWidth: '500px',
                margin: '0 auto',
                lineHeight: '1.6',
            }}>
                {error}
            </div>
        </div>
    )
}

export const ErrorDisplay = memo(ErrorDisplayComponent)
