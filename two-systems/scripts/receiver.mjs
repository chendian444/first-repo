import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
if (!['adaptive', 'prediction'].includes(kind)) throw new Error('Specify adaptive or prediction')
const senderPort = kind === 'adaptive' ? 8102 : 8103
const receiverPort = Number(process.env.RECEIVER_PORT || (kind === 'adaptive' ? 8302 : 8303))
process.env.DEFAULT_RECEIVER_PORT = String(receiverPort)
process.env.DEFAULT_RECEIVER_BOOTSTRAP_PORT = String(senderPort)
process.env.AUTO_START_RECEIVER = 'false'
const { startServer } = await import('../bridge/src/server.mjs')
startServer({
  port: receiverPort,
  frontendDist: path.join(root, 'apps', kind, 'ui'),
  sampleDataDir: path.join(root, 'backend/sample-data'),
  uploadsDir: path.join(root, 'runtime', kind, 'receiver-uploads'),
  receivedDir: process.env.RECEIVED_DIR || path.join(root, 'runtime', kind, 'receiver-received'),
  receiverUrl: ''
})
