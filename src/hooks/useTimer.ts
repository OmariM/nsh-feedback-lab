import { useState, useEffect, useRef, useCallback } from 'react'

export function useTimer(onComplete?: () => void) {
  const [timeLeft, setTimeLeft] = useState(0)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const clear = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const start = useCallback((seconds: number) => {
    clear()
    setTimeLeft(seconds)
    setRunning(true)
  }, [clear])

  const pause = useCallback(() => setRunning((r) => !r), [])

  const stop = useCallback(() => {
    clear()
    setRunning(false)
    setTimeLeft(0)
  }, [clear])

  const skip = useCallback(() => {
    clear()
    setRunning(false)
    setTimeLeft(0)
    onCompleteRef.current?.()
  }, [clear])

  // Adjust live countdown by delta seconds (clamped to >= 0)
  const adjust = useCallback((delta: number) => {
    setTimeLeft((prev) => Math.max(0, prev + delta))
  }, [])

  useEffect(() => {
    if (!running) {
      clear()
      return
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clear()
          setRunning(false)
          onCompleteRef.current?.()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return clear
  }, [running, clear])

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return { timeLeft, formatted, running, start, pause, stop, skip, adjust }
}
