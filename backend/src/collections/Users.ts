import type { Access, CollectionConfig } from 'payload'

export type UserRole = 'owner' | 'admin'

type AccessRequest = Parameters<Access>[0]['req']
type RoleAwareUser = {
  id?: number | string
  roles?: unknown
}

const roleOptions = [
  { label: 'Owner', value: 'owner' },
  { label: 'Admin', value: 'admin' },
] satisfies Array<{ label: string; value: UserRole }>

const isUserRole = (role: unknown): role is UserRole => role === 'owner' || role === 'admin'

const getRolesFromUser = (user: unknown): UserRole[] => {
  const roles = (user as RoleAwareUser | null)?.roles

  return Array.isArray(roles) ? roles.filter(isUserRole) : []
}

const getRolesForRequest = async (req: AccessRequest): Promise<UserRole[]> => {
  const roles = getRolesFromUser(req.user)

  if (roles.length > 0) {
    return roles
  }

  const userID = (req.user as RoleAwareUser | null)?.id

  if (!userID) {
    return []
  }

  try {
    const user = await req.payload.findByID({
      id: userID,
      collection: 'users',
      depth: 0,
      overrideAccess: true,
      req,
    })

    return getRolesFromUser(user)
  } catch {
    return []
  }
}

export const isOwner: Access = async ({ req }) => (await getRolesForRequest(req)).includes('owner')

export const isAdminOrOwner: Access = async ({ req }) =>
  (await getRolesForRequest(req)).some((role) => role === 'owner' || role === 'admin')

const canAccessAdmin = async ({ req }: { req: AccessRequest }) =>
  (await getRolesForRequest(req)).some((role) => role === 'owner' || role === 'admin')

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: canAccessAdmin,
    read: isAdminOrOwner,
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  fields: [
    // Email added by default
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['admin'],
      saveToJWT: true,
      options: roleOptions,
    },
  ],
}
