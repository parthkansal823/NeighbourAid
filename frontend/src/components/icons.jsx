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

/** Alert category → icon. Mirrors AlertCategory in the backend model. */
export const CATEGORY_ICONS = {
  medical: HeartPulse,
  flood: Droplets,
  fire: Flame,
  missing: Search,
  power: Zap,
  other: TriangleAlert,
}

/** Colour per category, for map pins and card chips. */
export const CATEGORY_COLORS = {
  medical: '#f87171',
  flood: '#38bdf8',
  fire: '#fb923c',
  missing: '#c084fc',
  power: '#facc15',
  other: '#9ca3af',
}

/**
 * Render the icon for an alert category.
 * Unknown categories fall back to the generic warning triangle rather than
 * rendering nothing, so a category added server-side never leaves a hole.
 */
export function CategoryIcon({ category, ...props }) {
  const Icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.other
  return <Icon aria-hidden {...props} />
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
  return <Icon aria-hidden {...props} />
}

/** Alert lifecycle status → icon. */
export const STATUS_ICONS = {
  open: Siren,
  accepted: Navigation,
  resolved: CheckCircle2,
}

export function StatusIcon({ status, ...props }) {
  const Icon = STATUS_ICONS[status] || Circle
  return <Icon aria-hidden {...props} />
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
  return <Icon aria-hidden {...props} />
}

/**
 * Spinner used by every async button. Previously each one inlined its own
 * hand-rolled <svg className="animate-spin">; this keeps them identical.
 */
export function Spinner({ className = 'h-4 w-4', ...props }) {
  return <LoaderCircle className={`animate-spin ${className}`} aria-hidden {...props} />
}
