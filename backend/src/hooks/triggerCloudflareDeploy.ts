import type { CollectionAfterChangeHook } from 'payload'

/**
 * Universal afterChange hook for Payload CMS v3 that triggers a Cloudflare Deploy Webhook.
 * 
 * Safely reads `CLOUDFLARE_WEBHOOK_URL` from environment variables and sends a POST request
 * only on 'create' and 'update' operations. Errors are caught and logged so that content
 * saving in the CMS is never blocked.
 */
export const triggerCloudflareDeploy: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
  collection,
}) => {
  // Only trigger on create and update operations
  if (operation !== 'create' && operation !== 'update') {
    return doc
  }

  // Safe read of the Cloudflare Deploy Webhook URL from environment variables
  const webhookUrl = process.env.CLOUDFLARE_WEBHOOK_URL?.trim()

  if (!webhookUrl) {
    req.payload.logger.warn(
      `[DeployWebhook] CLOUDFLARE_WEBHOOK_URL is not defined in environment variables. Skipping deploy trigger for ${collection.slug}.`,
    )
    return doc
  }

  try {
    req.payload.logger.info(
      `[DeployWebhook] Triggering Cloudflare deploy webhook for collection "${collection.slug}" (${operation})...`,
    )

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PayloadCMS-DeployWebhook/1.0',
      },
      body: JSON.stringify({
        event: 'deploy_trigger',
        collection: collection.slug,
        operation,
        id: doc?.id,
        updatedAt: new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      req.payload.logger.error(
        `[DeployWebhook] Cloudflare responded with status ${response.status} (${response.statusText}) for collection "${collection.slug}".`,
      )
    } else {
      req.payload.logger.info(
        `[DeployWebhook] Cloudflare deploy successfully triggered for collection "${collection.slug}".`,
      )
    }
  } catch (error) {
    // Catch network / fetch errors without interrupting CMS save flow
    req.payload.logger.error(
      `[DeployWebhook] Failed to send deploy webhook to Cloudflare: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return doc
}
