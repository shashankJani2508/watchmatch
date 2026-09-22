'use client'

import { motion, useMotionValue, useTransform, useAnimation, PanInfo } from 'framer-motion'
import { Title } from '@/types'

interface Props {
  title: Title
  isTop: boolean
  stackPosition: number  // 0 = front, 1 = middle, 2 = back
  onSwipe?: (direction: 'left' | 'right') => void
}

const SWIPE_THRESHOLD = 80

export default function SwipeCard({ title, isTop, stackPosition, onSwipe }: Props) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-220, 220], [-18, 18])
  const likeOpacity = useTransform(x, [40, 130], [0, 1])
  const passOpacity = useTransform(x, [-130, -40], [1, 0])
  const controls = useAnimation()

  // Stack appearance
  const scale = 1 - stackPosition * 0.04
  const yOffset = stackPosition * 14

  async function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const offset = info.offset.x
    const velocity = info.velocity.x

    if (offset > SWIPE_THRESHOLD || velocity > 500) {
      await controls.start({ x: 600, rotate: 25, opacity: 0, transition: { duration: 0.3 } })
      onSwipe?.('right')
    } else if (offset < -SWIPE_THRESHOLD || velocity < -500) {
      await controls.start({ x: -600, rotate: -25, opacity: 0, transition: { duration: 0.3 } })
      onSwipe?.('left')
    } else {
      controls.start({ x: 0, rotate: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } })
    }
  }

  return (
    <motion.div
      className="absolute inset-0 rounded-2xl overflow-hidden shadow-2xl swipe-card"
      style={{
        x: isTop ? x : 0,
        rotate: isTop ? rotate : 0,
        scale,
        y: yOffset,
        zIndex: 10 - stackPosition,
        backgroundImage: `url(${title.posterPath})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={isTop ? handleDragEnd : undefined}
      animate={controls}
      whileDrag={{ cursor: 'grabbing' }}
      initial={false}
    >
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-black/10" />

      {/* LIKE badge */}
      {isTop && (
        <motion.div
          className="absolute top-7 right-5 bg-success text-white font-black text-lg px-4 py-1.5 rounded-lg border-4 border-success/60 rotate-12 tracking-widest shadow-lg"
          style={{ opacity: likeOpacity }}
        >
          LIKE
        </motion.div>
      )}

      {/* PASS badge */}
      {isTop && (
        <motion.div
          className="absolute top-7 left-5 bg-danger text-white font-black text-lg px-4 py-1.5 rounded-lg border-4 border-danger/60 -rotate-12 tracking-widest shadow-lg"
          style={{ opacity: passOpacity }}
        >
          PASS
        </motion.div>
      )}

      {/* Title info */}
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <div className="flex items-end justify-between mb-1">
          <h3 className="text-2xl font-bold text-white leading-tight flex-1 pr-2">
            {title.title}
          </h3>
          <div className="flex flex-col items-end flex-shrink-0">
            <span className="text-accent font-bold text-sm">★ {title.imdbRating}</span>
            {title.runtime && (
              <span className="text-gray-400 text-xs">{title.runtime}m</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
          <span>{title.year}</span>
          {title.type === 'tv' && (
            <>
              <span>·</span>
              <span className="bg-white/15 text-white px-2 py-0.5 rounded-full">Series</span>
            </>
          )}
        </div>

        {title.synopsis && (
          <p className="text-gray-300 text-sm leading-snug line-clamp-2 mb-3">
            {title.synopsis}
          </p>
        )}

        {title.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {title.genres.slice(0, 4).map(g => (
              <span
                key={g}
                className="text-xs px-2.5 py-0.5 rounded-full bg-white/15 text-white font-medium"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
