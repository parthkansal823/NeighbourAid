# Frontend UI technology plan

Implemented stack-upgrade pass: 8 October 2026. The user selected the current React + Capacitor stack, not a React Native rewrite. React 19, Vite 8, Tailwind 4, Lucide and Capacitor 8 remain the foundation. Existing appearance, compact shell, launch, notification, dialog and offline utilities are reused. See [the implementation and verification record](../../tech-stack-upgrade.md).

| Addition / status | Purpose | Constraint |
| --- | --- | --- |
| `useKeyboardInsets` — implemented | Native keyboard events, VisualViewport fallback, focus reveal and dismissal keep the usable viewport explicit. | Resize/overlay, pinch zoom, listener cleanup and unavailable bridges are unit-tested. Actual fullscreen Android keyboard/IME testing is still required. |
| `useAndroidBackButton` — implemented | Close the topmost dialog before route navigation; protect report drafts and in-flight work. | Native App plugin only. Header/tab/link navigation shares the draft guard. Website never exits a native app. |
| Native haptics — implemented | Optional feedback on deliberate actions through the official Haptics bridge. | Feature detection, preference and browser fallback; never a prerequisite for submitting or responding. |
| `useReducedMotion` — implemented | Live system preference shared with the launch hook; CSS motion also respects the preference. | No new animation library was needed for the existing logo. |
| TanStack Query — implemented | Abortable account-isolated relay/inbox requests, short-lived memory cache and invalidation after explicit changes. | No private persistent cache, cross-account placeholder data or automatic emergency mutation retries. |
| `useTransition` / `useDeferredValue` — deferred | Consider for expensive nonurgent filtering only after profiling. | Never defer emergency submission or delivery acknowledgment; these hooks do not move expensive JavaScript off-thread. |

Official references:

- Capacitor Keyboard: https://capacitorjs.com/docs/apis/keyboard
- Capacitor App / Android back-button events: https://capacitorjs.com/docs/apis/app
- Capacitor Haptics: https://capacitorjs.com/docs/apis/haptics
- React useSyncExternalStore: https://react.dev/reference/react/useSyncExternalStore
- TanStack Query: https://tanstack.com/query/latest/docs/framework/react/overview
- React useTransition: https://react.dev/reference/react/useTransition
- React useDeferredValue: https://react.dev/reference/react/useDeferredValue

Playwright/axe and the existing Vitest suite verify browser behavior with fictional APIs and blocked writes. Android Studio's JBR builds the generated Capacitor shell; this is not proof of physical-device behavior. Figma design work remains separate and paused at its account quota until the student account is connected. No paid service, provider credential or account setting was changed. No additional UI kit or React Native/Flutter migration was added.
