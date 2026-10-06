import { useEffect, useState } from 'react'
import api from '../utils/api'
import { Handshake } from './icons'
import { useAuth } from '../context/AuthContext'

/**
 * Renders a row of chips for the user's saved emergency contacts. Tapping
 * a chip opens a tel:/sms:/mailto: link with a pre-filled message — the
 * client-side "buddy ping". The backend never sends messages on the user's
 * behalf (no paid SMS/email provider), which keeps NeighbourAid free and
 * private by default.
 */
export default function BuddyPing({ message, compact = false }) {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api
      .get('/api/users/me')
      .then(({ data }) => {
        if (!cancelled) setContacts(data.emergency_contacts || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  if (!user || contacts.length === 0) return null

  const text = message || 'I need help — please check on me.'

  const linkFor = (c) => {
    if (c.phone) {
      // On most mobile browsers, sms: with a body pre-fills the default messages app.
      // Desktop browsers may ignore the body — the phone number still works.
      return `sms:${c.phone}?body=${encodeURIComponent(text)}`
    }
    if (c.email) {
      return `mailto:${c.email}?subject=${encodeURIComponent('Help needed')}&body=${encodeURIComponent(text)}`
    }
    return null
  }

  return (
    <div className={compact ? 'mt-2' : 'mt-3'}>
      {!compact && (
        <div className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-widest">
          Ping a buddy
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {contacts.map((c, i) => {
          const href = linkFor(c)
          if (!href) return null
          return (
            <a
              key={i}
              href={href}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-100 px-2.5 py-1 rounded-full flex items-center gap-1"
              title={`Ping ${c.name}${c.phone ? ` · ${c.phone}` : ''}`}
            >
              <Handshake className="h-3.5 w-3.5" aria-hidden />
              <span className="truncate max-w-[120px]">{c.name}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
