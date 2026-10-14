import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { softwareConfig } from './software-config.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
const { port: senderPort, receiverPort: defaultReceiverPort } = softwareConfig(kind)
const receiverPort = Number(process.env.RECEIVER_PORT || defaultReceiverPort)
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
