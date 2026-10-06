import Link from 'next/link'
import React from 'react'

interface DashboardCard {
  href: string
  label: string
  tag: string
  tagColor: string
  description: string
  icon: string
}

const mainCards: DashboardCard[] = [
  {
    href: '/panel/globals/home-page',
    label: 'Home Page & Music',
    tag: 'Global',
    tagColor: '#a855f7',
    description: 'Configure profile bio, role, social links, Discord ID, and active YouTube Music track/playlist.',
    icon: '🏠',
  },
  {
    href: '/panel/collections/projects',
    label: 'Projects',
    tag: 'Collection',
    tagColor: '#38bdf8',
    description: 'Manage showcase portfolio projects, markdown documentation, and status tags (Active/In Progress/Archived).',
    icon: '🚀',
  },
  {
    href: '/panel/collections/technologies',
    label: 'Technologies Stack',
    tag: 'Collection',
    tagColor: '#4ade80',
    description: 'Manage technology items by categories (OS Tools, Languages, Networks, Game Servers).',
    icon: '⚡',
  },
  {
    href: '/panel/collections/media',
    label: 'Media Gallery',
    tag: 'Collection',
    tagColor: '#f43f5e',
    description: 'Upload, inspect, and organize image assets and artwork used across the hub.',
    icon: '🖼️',
  },
]

const securityCards: DashboardCard[] = [
  {
    href: '/panel/collections/access-keys',
    label: 'SFCP License Keys',
    tag: 'Security & Licensing',
    tagColor: '#f59e0b',
    description: 'Issue, bind HWID, activate, or revoke Smart File Collector Pro hardware-locked access licenses.',
    icon: '🔑',
  },
  {
    href: '/panel/collections/key-logs',
    label: 'License Validation Logs',
    tag: 'Telemetry',
    tagColor: '#eab308',
    description: 'Audit real-time license check requests, IP addresses, client software fingerprints, and status logs.',
    icon: '📜',
  },
  {
    href: '/panel/collections/users',
    label: 'Admin Accounts',
    tag: 'Auth',
    tagColor: '#94a3b8',
    description: 'Manage admin users, roles, email credentials, and active session tokens.',
    icon: '🛡️',
  },
]

export const AdminDashboard = () => (
  <main
    style={{
      backgroundColor: '#0c0c11',
      color: '#e2e8f0',
      fontFamily: "'JetBrains Mono', monospace, -apple-system, sans-serif",
      minHeight: '100vh',
      padding: '40px 24px',
    }}
  >
    <div style={{ margin: '0 auto', maxWidth: '1100px' }}>
      {/* Top Cyberpunk Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 27, 46, 0.7) 0%, rgba(18, 16, 28, 0.9) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.3)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(168, 85, 247, 0.1)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '20px',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '28px 32px',
          marginBottom: '36px',
        }}
      >
        <div>
          <div style={{ alignItems: 'center', display: 'flex', gap: '10px', marginBottom: '8px' }}>
            <span
              style={{
                backgroundColor: 'rgba(168, 85, 247, 0.18)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                borderRadius: '6px',
                color: '#c084fc',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                padding: '2px 8px',
                textTransform: 'uppercase',
              }}
            >
              Terminal // Root
            </span>
            <span style={{ color: '#4ade80', fontSize: '12px' }}>● Database Online</span>
          </div>

          <h1
            style={{
              color: '#ffffff',
              fontSize: '28px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '0 0 6px 0',
              textShadow: '0 0 20px rgba(168, 85, 247, 0.4)',
            }}
          >
            HEYSH1N CONTROL PANEL
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
            Unified workspace for website configuration, portfolio projects, and SFCP licensing API.
          </p>
        </div>

        {/* Live Site Shortcut */}
        <div>
          <a
            href="http://localhost:4321"
            target="_blank"
            rel="noreferrer"
            style={{
              alignItems: 'center',
              background: 'linear-gradient(135deg, #7e22ce 0%, #a855f7 100%)',
              border: 'none',
              borderRadius: '10px',
              boxShadow: '0 4px 18px rgba(168, 85, 247, 0.35)',
              color: '#ffffff',
              display: 'inline-flex',
              fontSize: '13px',
              fontWeight: 700,
              gap: '8px',
              padding: '12px 20px',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <span>Open Live Site</span>
            <span style={{ fontSize: '16px' }}>↗</span>
          </a>
        </div>
      </div>

      {/* Section 1: Portfolio & Content Management */}
      <div style={{ marginBottom: '36px' }}>
        <h2
          style={{
            alignItems: 'center',
            color: '#c084fc',
            display: 'flex',
            fontSize: '14px',
            fontWeight: 700,
            gap: '8px',
            letterSpacing: '0.08em',
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
          }}
        >
          <span>◈</span> Portfolio & Content
        </h2>

        <div
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          {mainCards.map((card) => (
            <Link
              href={card.href}
              key={card.href}
              style={{
                backgroundColor: 'rgba(20, 20, 30, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                color: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '22px',
                textDecoration: 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '24px' }}>{card.icon}</span>
                  <span
                    style={{
                      backgroundColor: `${card.tagColor}18`,
                      border: `1px solid ${card.tagColor}44`,
                      borderRadius: '5px',
                      color: card.tagColor,
                      fontSize: '10px',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      padding: '2px 8px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {card.tag}
                  </span>
                </div>
                <h3 style={{ color: '#ffffff', fontSize: '17px', fontWeight: 700, margin: '0 0 8px 0' }}>
                  {card.label}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '12px', lineHeight: '1.5', margin: 0 }}>
                  {card.description}
                </p>
              </div>

              <div
                style={{
                  alignItems: 'center',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#a855f7',
                  display: 'flex',
                  fontSize: '12px',
                  fontWeight: 600,
                  gap: '6px',
                  marginTop: '16px',
                  paddingTop: '12px',
                }}
              >
                <span>Configure</span>
                <span>→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Section 2: SFCP Licensing & Administration */}
      <div style={{ marginBottom: '36px' }}>
        <h2
          style={{
            alignItems: 'center',
            color: '#f59e0b',
            display: 'flex',
            fontSize: '14px',
            fontWeight: 700,
            gap: '8px',
            letterSpacing: '0.08em',
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
          }}
        >
          <span>◈</span> SFCP Software Licensing & Auth
        </h2>

        <div
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          {securityCards.map((card) => (
            <Link
              href={card.href}
              key={card.href}
              style={{
                backgroundColor: 'rgba(20, 20, 30, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                color: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '22px',
                textDecoration: 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '24px' }}>{card.icon}</span>
                  <span
                    style={{
                      backgroundColor: `${card.tagColor}18`,
                      border: `1px solid ${card.tagColor}44`,
                      borderRadius: '5px',
                      color: card.tagColor,
                      fontSize: '10px',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      padding: '2px 8px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {card.tag}
                  </span>
                </div>
                <h3 style={{ color: '#ffffff', fontSize: '17px', fontWeight: 700, margin: '0 0 8px 0' }}>
                  {card.label}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '12px', lineHeight: '1.5', margin: 0 }}>
                  {card.description}
                </p>
              </div>

              <div
                style={{
                  alignItems: 'center',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  color: card.tagColor,
                  display: 'flex',
                  fontSize: '12px',
                  fontWeight: 600,
                  gap: '6px',
                  marginTop: '16px',
                  paddingTop: '12px',
                }}
              >
                <span>Manage</span>
                <span>→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* System Quick Specs Box */}
      <div
        style={{
          backgroundColor: 'rgba(15, 15, 22, 0.6)',
          border: '1px solid rgba(168, 85, 247, 0.2)',
          borderRadius: '12px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '24px',
          justifyContent: 'space-around',
          padding: '20px 24px',
        }}
      >
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px', textTransform: 'uppercase' }}>Database</span>
          <span style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600 }}>Neon PostgreSQL (AWS us-east-1)</span>
        </div>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px', textTransform: 'uppercase' }}>CMS Engine</span>
          <span style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600 }}>Payload v3.85.0 + Next.js</span>
        </div>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px', textTransform: 'uppercase' }}>Endpoints</span>
          <span style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600 }}>/api/validate-license | /api/ytmusic</span>
        </div>
        <div>
          <span style={{ color: '#64748b', display: 'block', fontSize: '11px', textTransform: 'uppercase' }}>Frontend Hub</span>
          <span style={{ color: '#a855f7', fontSize: '13px', fontWeight: 600 }}>Astro v5 (Port 4321)</span>
        </div>
      </div>
    </div>
  </main>
)

export default AdminDashboard
