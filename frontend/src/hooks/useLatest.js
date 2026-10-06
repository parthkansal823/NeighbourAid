import { useEffect, useRef } from 'react'

/**
 * Keep a ref pointing at the most recent value, updated after commit.
 *
 * The pattern this replaces was `const ref = useRef(v); ref.current = v`
 * written straight in the component body. That mutates during render, which
 * React 19 explicitly disallows: with concurrent rendering a render can be
 * started and thrown away, so the ref ends up holding a value from a render
 * that never committed. StrictMode's double-render makes it worse.
 *
 * Assigning inside an effect means the ref only ever reflects committed
 * state. The tradeoff is that the ref is one commit behind during the render
 * itself — fine for the way we use it, since every read happens later, from
 * an event handler, a socket callback or a timer.
 */
export function useLatest(value) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
