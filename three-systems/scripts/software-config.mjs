export const softwareConfigs = {
  monitor: { port: 8101, backendPort: 8201, receiverPort: 8301 },
  adaptive: { port: 8102, backendPort: 8202, receiverPort: 8302 },
  prediction: { port: 8103, backendPort: 8203, receiverPort: 8303 }
}
export function softwareConfig(kind) {
  if (!Object.hasOwn(softwareConfigs, kind)) throw new Error('Specify monitor, adaptive or prediction')
  return softwareConfigs[kind]
}
