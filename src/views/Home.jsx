import React from 'react'
import Dashboard from './Dashboard.jsx'
import { PublicHome } from './PublicSite.jsx'
import { useAccess } from '../access/AccessContext.jsx'

/**
 * Home means different things by session: a public visitor gets the landing page, an authorized
 * team gets its private dashboard. The dashboard already owns team identity, so this screen does
 * not repeat it in a second header.
 */
export default function Home() {
  const { isTeam, isOwner } = useAccess()
  if (!isTeam && !isOwner) return <PublicHome />
  return <Dashboard />
}
