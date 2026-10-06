import React from 'react'

export const AdminLogo = () => (
  <div
    style={{
      alignItems: 'center',
      display: 'inline-flex',
      gap: '10px',
      padding: '4px 0',
      textDecoration: 'none',
    }}
  >
    <div
      style={{
        alignItems: 'center',
        background: 'linear-gradient(135deg, #7e22ce 0%, #a855f7 50%, #c084fc 100%)',
        borderRadius: '8px',
        boxShadow: '0 0 16px rgba(168, 85, 247, 0.45)',
        color: '#ffffff',
        display: 'flex',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '15px',
        fontWeight: 800,
        height: '32px',
        justifyContent: 'center',
        letterSpacing: '0.05em',
        width: '32px',
      }}
    >
      H_
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
      <span
        style={{
          color: '#ffffff',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '15px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textShadow: '0 0 10px rgba(168, 85, 247, 0.5)',
        }}
      >
        HEYSH1N
      </span>
      <span
        style={{
          color: '#a855f7',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        System // Hub
      </span>
    </div>
  </div>
)

export default AdminLogo
