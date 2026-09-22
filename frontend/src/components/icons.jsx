/**
 * Central icon vocabulary.
 *
 * The app used to render emoji (🚨 🏥 🌊) as its icon set. That looked fine
 * on the author's machine and inconsistent everywhere else: emoji glyphs are
 * supplied by the OS, so the same alert card renders as flat monochrome on
 * Windows, 3-D blobs on Android, and tofu boxes wherever the font is missing.
 * They also can't inherit `currentColor`, can't be sized in `em`, and are
 * announced verbatim by screen readers ("fire engine", "ocean wave").
 *
 * Everything now routes through lucide's stroked SVGs, which inherit colour
 * and size from CSS and carry no text content of their own. Importing them
 * here rather than per-file means the domain mappings (category → icon,
 * urgency → icon) stay consistent across the map, the feed, and the cards.
 *
 * Icons are decorative wherever a text label sits next to them, so they get
 * `aria-hidden`. Where an icon is the *only* content of a control, pass a
 * `title` (lucide renders it as an accessible <title>) or label the control.
 */

import {
  Accessibility,
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Baby,
  BadgeCheck,
  Ban,
  BatteryCharging,
  Bell,
  BellRing,
  Bot,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  Clock,
  CloudRain,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Copy,
  Crosshair,
  Dna,
  Droplet,
  Droplets,
  Eye,
  Flag,
  Flame,
  Globe,
  Handshake,
  Hourglass,
  Heart,
  HeartHandshake,
  HeartPulse,
  HelpCircle,
  Home,
  Hospital,
  Image as ImageIcon,
  Inbox,
  Info,
  Languages,
  LifeBuoy,
  Menu,
  Link2,
  LoaderCircle,
  LogOut,
  Map,
  MapPin,
  Mic,
  MessageCircle,
  MicOff,
  Navigation,
  Package,
  PawPrint,
  PersonStanding,
  Phone,
  PhoneCall,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Send,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldUser,
  Siren,
  Sparkles,
  Star,
  Stethoscope,
  Tag,
  Timer,
  Trash2,
  TriangleAlert,
  Truck,
  User,
  UserRound,
  UserRoundX,
  Users,
  VenusAndMars,
  Waves,
  Volume2,
  VolumeX,
  WifiOff,
  Wind,
  X,
  Zap,
} from 'lucide-react'

export {
  Accessibility,
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Baby,
  BadgeCheck,
  Ban,
  BatteryCharging,
  Bell,
  BellRing,
  Bot,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDot,
  Clock,
  CloudRain,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Copy,
  Crosshair,
  Dna,
  Droplet,
  Droplets,
  Eye,
  Flag,
  Flame,
  Globe,
  Handshake,
  Hourglass,
  Heart,
  HeartHandshake,
  HeartPulse,
  HelpCircle,
  Home,
  Hospital,
  ImageIcon,
  Inbox,
  Info,
  Languages,
  LifeBuoy,
  Link2,
  LoaderCircle,
  LogOut,
  Map,
  MapPin,
  Menu,
  Mic,
  MessageCircle,
  MicOff,
  Navigation,
  Package,
  PersonStanding,
  Phone,
  PhoneCall,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Send,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldUser,
  Siren,
  Sparkles,
  Star,
  Stethoscope,
  Tag,
  Timer,
  Trash2,
  TriangleAlert,
  Truck,
  User,
  UserRound,
  UserRoundX,
  Users,
  VenusAndMars,
  Waves,
  Volume2,
  VolumeX,
  WifiOff,
  Wind,
  X,
  Zap,
}

/**
 * Optical sizing.
 *
 * lucide draws on a 24px grid with a 2px stroke. An SVG scales its stroke
 * along with everything else, so the same icon rendered at the nine sizes
 * this app uses comes out at nine different apparent weights:
 *
 *     h-3  (12px) -> 1.0px stroke   thin, details merge, reads as washed out
 *     h-4  (16px) -> 1.3px
 *     h-6  (24px) -> 2.0px          the weight it was designed at
 *     h-12 (48px) -> 4.0px          heavy and clumsy
 *     h-16 (64px) -> 5.3px          a cartoon of itself
 *
 * That is why icons looked inconsistent across the app without any one of
 * them looking obviously wrong. The fix is to counter-scale the stroke so
 * the RENDERED weight stays near 1.6px at every size, which is what icon
 * families with real optical sizes do.
 *
 * Hand-drawing replacements was the other option and would have been worse:
 * lucide's glyphs are optically balanced and terminate consistently, and
 * ninety bespoke SVGs would not be.
 */
const STROKE_FOR_SIZE = [
  // [max px, strokeWidth] — first match wins, so keep it ascending.
  [14, 3.0], // 12px -> 1.50px rendered
  [18, 2.5], // 16px -> 1.67px
  [22, 2.0], // 20px -> 1.67px
  [28, 1.75], // 24px -> 1.75px
  [40, 1.25], // 32px -> 1.67px
  [56, 0.9], // 48px -> 1.80px
  [Infinity, 0.65], // 64px -> 1.73px
]

/**
 * Pixel size for a Tailwind `h-N` step. The app sizes icons with classes,
 * not props, so the stroke has to be derived from the class it was given.
 */
const PX_FOR_STEP = {
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  12: 48,
  16: 64,
}

export function strokeForClass(className = '') {
  const match = /\bh-([0-9.]+)\b/.exec(className)
  const px = match ? PX_FOR_STEP[Number(match[1])] : undefined
  // Unrecognised or absent size: leave lucide's own default alone rather
  // than guessing, so an icon sized some other way is never made worse.
  if (px === undefined) return undefined
  return STROKE_FOR_SIZE.find(([max]) => px <= max)[1]
}

/**
 * Alert category → icon. Mirrors AlertCategory in the backend model, and is
 * meant to cover all of it rather than the common few.
 *
 * The fallback in `CategoryIcon` is a real safety net for a category added
 * server-side ahead of the client, but it had been doing that job for half
 * the enum: accident, violence, animal, gas, water and structure every one
 * rendered the same generic warning triangle. On a map of pins, and on a feed
 * scanned under stress, identical icons are worse than no icon — they read as
 * one kind of thing.
 */
export const CATEGORY_ICONS = {
  medical: HeartPulse,
  flood: Droplets,
  fire: Flame,
  missing: Search,
  power: Zap,
  accident: Car,
  violence: ShieldAlert,
  animal: PawPrint,
  gas: Wind,
  water: Droplet,
  structure: Home,
  other: TriangleAlert,
}

/** Colour per category, for map pins and card chips. */
export const CATEGORY_COLORS = {
  medical: '#f87171', // red
  flood: '#38bdf8', // sky
  fire: '#fb923c', // orange
  missing: '#c084fc', // purple
  power: '#facc15', // yellow
  accident: '#f472b6', // pink
  violence: '#ef4444', // deeper red — distinct from medical at pin size
  animal: '#a3e635', // lime
  gas: '#22d3ee', // cyan
  water: '#60a5fa', // blue — deliberately apart from flood's sky
  structure: '#fbbf24', // amber
  other: '#9ca3af', // grey
}

/**
 * Render the icon for an alert category.
 * Unknown categories fall back to the generic warning triangle rather than
 * rendering nothing, so a category added server-side never leaves a hole.
 */
export function CategoryIcon({ category, ...props }) {
  const Icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.other
  return <Icon aria-hidden strokeWidth={strokeForClass(props.className)} {...props} />
}

/** Urgency → icon. CRITICAL gets the siren; the rest scale down in weight. */
export const URGENCY_ICONS = {
  CRITICAL: Siren,
  HIGH: AlertTriangle,
  MEDIUM: Info,
  LOW: Circle,
}

export function UrgencyIcon({ urgency, ...props }) {
  const Icon = URGENCY_ICONS[urgency] || Info
  return <Icon aria-hidden strokeWidth={strokeForClass(props.className)} {...props} />
}

/** Alert lifecycle status → icon. */
export const STATUS_ICONS = {
  open: Siren,
  accepted: Navigation,
  resolved: CheckCircle2,
}

export function StatusIcon({ status, ...props }) {
  const Icon = STATUS_ICONS[status] || Circle
  return <Icon aria-hidden strokeWidth={strokeForClass(props.className)} {...props} />
}

/** Resource-pin kind → icon, matching ResourceKind in the backend model. */
export const RESOURCE_ICONS = {
  shelter: Home,
  food: Package,
  blood: Droplet,
  oxygen: Wind,
  water: Droplets,
  medical_camp: Hospital,
  other: MapPin,
}

export function ResourceIcon({ kind, ...props }) {
  const Icon = RESOURCE_ICONS[kind] || RESOURCE_ICONS.other
  return <Icon aria-hidden strokeWidth={strokeForClass(props.className)} {...props} />
}

/**
 * Spinner used by every async button. Previously each one inlined its own
 * hand-rolled <svg className="animate-spin">; this keeps them identical.
 */
export function Spinner({ className = 'h-4 w-4', ...props }) {
  return <LoaderCircle className={`animate-spin ${className}`} aria-hidden {...props} />
}
