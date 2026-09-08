import { getUser } from '@netlify/identity'

export async function requireUser() {
  const user = await getUser()
  if (!user?.id || !user.email) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return { id: user.id, email: user.email, name: user.name ?? user.email.split('@')[0] }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error
  console.error(error)
  return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
}
