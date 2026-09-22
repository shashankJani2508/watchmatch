'use client'

import { useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

interface Props {
  url: string
  sessionId: string
}

export default function QRCodeShare({ url, sessionId }: Props) {
  const qrRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)

  async function copyLink() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function shareQR() {
    setSharing(true)
    try {
      const canvas = qrRef.current?.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return

      // Try Web Share API with image file (mobile)
      if (navigator.share) {
        canvas.toBlob(async (blob) => {
          if (!blob) return
          const file = new File([blob], 'watchmatch-invite.png', { type: 'image/png' })
          try {
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({
                title: 'Join my WatchMatch session',
                text: `Tap to join: ${url}`,
                files: [file],
              })
            } else {
              await navigator.share({ title: 'Join my WatchMatch session', url })
            }
          } catch {
            // User cancelled or share failed — silently ignore
          }
        })
      } else {
        // Fallback: download QR as PNG
        const dataUrl = (qrRef.current?.querySelector('canvas') as HTMLCanvasElement)?.toDataURL('image/png')
        if (dataUrl) {
          const a = document.createElement('a')
          a.href = dataUrl
          a.download = 'watchmatch-qr.png'
          a.click()
        }
      }
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="text-center">
      <p className="font-semibold text-lg mb-1">Share with your partner</p>
      <p className="text-sm text-gray-400 mb-6">
        They scan this QR or you send them the link below.
      </p>

      {/* QR code */}
      <div
        ref={qrRef}
        className="inline-block bg-white p-4 rounded-2xl shadow-xl shadow-primary/20"
      >
        <QRCodeCanvas
          value={url}
          size={200}
          bgColor="#ffffff"
          fgColor="#0d0d18"
          level="M"
        />
      </div>

      {/* Session ID subtle display */}
      <p className="mt-3 text-xs text-gray-500 font-mono">
        Session #{sessionId.slice(0, 8).toUpperCase()}
      </p>

      {/* Action buttons */}
      <div className="mt-5 flex gap-3">
        <button
          onClick={copyLink}
          className="flex-1 py-3 bg-surface2 hover:bg-surface rounded-xl text-sm font-medium transition-all active:scale-95"
        >
          {copied ? '✓ Copied!' : '🔗 Copy link'}
        </button>
        <button
          onClick={shareQR}
          disabled={sharing}
          className="flex-1 py-3 bg-primary hover:bg-primary-light disabled:opacity-60 rounded-xl text-sm font-medium transition-all active:scale-95"
        >
          {sharing ? '…' : '📤 Share QR'}
        </button>
      </div>

      {/* Link preview */}
      <div className="mt-3 p-3 bg-surface2 rounded-xl text-xs text-gray-400 font-mono break-all text-left">
        {url}
      </div>
    </div>
  )
}
