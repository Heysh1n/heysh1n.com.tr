import Link from 'next/link'

const cards = [
  {
    href: '/panel/collections/projects',
    label: 'Projects',
    description: 'Create and edit portfolio project entries.',
  },
  {
    href: '/panel/collections/technologies',
    label: 'Technologies',
    description: 'Manage stack categories and technology names.',
  },
  {
    href: '/panel/collections/access-keys',
    label: 'Access Keys',
    description: 'Private license and API key metadata.',
  },
]

export const AdminDashboard = () => (
  <main style={{ padding: '32px' }}>
    <div style={{ margin: '0 auto', maxWidth: '960px' }}>
      <p style={{ color: 'var(--theme-elevation-500)', margin: 0, textTransform: 'uppercase' }}>
        Portfolio CMS
      </p>
      <h1 style={{ margin: '12px 0 8px' }}>Dashboard</h1>
      <p style={{ color: 'var(--theme-elevation-600)', marginBottom: '28px' }}>
        Modular dashboard is disabled here to avoid the current admin runtime issue.
      </p>

      <div
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        {cards.map((card) => (
          <Link
            href={card.href}
            key={card.href}
            style={{
              border: '1px solid var(--theme-elevation-150)',
              borderRadius: '6px',
              color: 'inherit',
              display: 'block',
              padding: '20px',
              textDecoration: 'none',
            }}
          >
            <h2 style={{ fontSize: '20px', margin: '0 0 8px' }}>{card.label}</h2>
            <p style={{ color: 'var(--theme-elevation-600)', margin: 0 }}>{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  </main>
)

export default AdminDashboard
