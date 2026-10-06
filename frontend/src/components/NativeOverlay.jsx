import { createPortal } from 'react-dom'
import { isNativeApp } from '../utils/runtime'

/** Escape clipping/animated cards; only native dialogs receive app safe-area styling. */
export default function NativeOverlay({ children }) {
  return createPortal(<div className={`app-overlay${isNativeApp() ? ' native-overlay' : ''}`}>{children}</div>, document.body)
}
