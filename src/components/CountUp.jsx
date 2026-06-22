import { useEffect, useState } from 'react'

/**
 * Animated count-up number. Uses requestAnimationFrame for smoothness.
 * Set `prefix`/`suffix` for currency or units, `decimals` for precision.
 */
export default function CountUp({
  value = 0,
  duration = 900,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = '',
}) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const target = Number(value) || 0
    const start = performance.now()
    let raf

    const tick = (now) => {
      const elapsed = now - start
      const t = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else setDisplay(target)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  const formatted =
    decimals > 0
      ? display.toLocaleString(undefined, { maximumFractionDigits: decimals })
      : Math.round(display).toLocaleString()

  return (
    <span className={'num tabular-nums ' + className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}
