'use client'

type ValidBridgeSpinnerProps = {
  size?: number
  className?: string
}

function ValidBridgeSpinner({ size = 44, className = '' }: ValidBridgeSpinnerProps) {
  return (
    <div className={`flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full animate-spin"
        style={{
          border: '2.5px solid transparent',
          borderTopColor: '#a1a1aa',
          animationDuration: '0.9s',
        }}
      />
    </div>
  )
}

export default ValidBridgeSpinner
