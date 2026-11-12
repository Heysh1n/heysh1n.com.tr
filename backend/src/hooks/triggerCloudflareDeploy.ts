import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from 'payload'

const sendCloudflareDeployWebhook = async (
  targetSlug: string,
  operation: string,
  id: unknown,
  logger: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  },
) => {
  const webhookUrl = process.env.CLOUDFLARE_WEBHOOK_URL?.trim()

  if (!webhookUrl) {
    logger.warn(
      `[DeployWebhook] CLOUDFLARE_WEBHOOK_URL is not defined in environment variables. Skipping deploy trigger for ${targetSlug}.`,
    )
    return
  }

  try {
    logger.info(
      `[DeployWebhook] Triggering Cloudflare deploy webhook for "${targetSlug}" (${operation})...`,
    )

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PayloadCMS-DeployWebhook/1.0',
      },
      body: JSON.stringify({
        event: 'deploy_trigger',
        collection: targetSlug,
        operation,
        id,
        updatedAt: new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      logger.error(
        `[DeployWebhook] Cloudflare responded with status ${response.status} (${response.statusText}) for "${targetSlug}".`,
      )
    } else {
      logger.info(
        `[DeployWebhook] Cloudflare deploy successfully triggered for "${targetSlug}".`,
      )
    }
  } catch (error) {
    logger.error(
      `[DeployWebhook] Failed to send deploy webhook to Cloudflare: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export const triggerCloudflareDeploy: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
  collection,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return doc
  }

  await sendCloudflareDeployWebhook(collection.slug, operation, doc?.id, req.payload.logger)

  return doc
}

export const triggerCloudflareDeployGlobal: GlobalAfterChangeHook = async ({
  doc,
  req,
  global,
}) => {
  await sendCloudflareDeployWebhook(global.slug, 'update', doc?.id, req.payload.logger)

  return doc
}
