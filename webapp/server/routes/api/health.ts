/**
 * Health check endpoint for load balancers and container orchestrators.
 * Returns 200 with a JSON body confirming the server is running.
 */
import { defineEventHandler } from 'nitro/h3'

export default defineEventHandler(() => {
  return { status: 'ok', timestamp: Date.now() }
})
