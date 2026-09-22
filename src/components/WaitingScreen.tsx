'use client'

interface Props {
  message: string
  subMessage?: string
  showSpinner?: boolean
}

export default function WaitingScreen({ message, subMessage, showSpinner = true }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
      {showSpinner && (
        <div className="w-12 h-12 border-3 border-white/20 border-t-primary rounded-full animate-spin mb-6"
          style={{ borderWidth: '3px' }}
        />
      )}
      <p className="text-lg font-semibold mb-2">{message}</p>
      {subMessage && <p className="text-sm text-gray-400">{subMessage}</p>}
    </div>
  )
}
