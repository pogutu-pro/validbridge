'use client'
import { motion } from 'motion/react'

function PageLoading() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex flex-col items-center gap-4"
      >
        <motion.img
          src="/validbridge.svg"
          alt="ValidBridge"
          width={44}
          height={44}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="text-sm font-semibold tracking-wide text-black/40">
          Valid<span className="text-[#FF5A1F]">Bridge</span>
        </span>
      </motion.div>
    </div>
  )
}

export default PageLoading
