export const softwareConfigs = {
  monitor: { name: '工业网络传输状态实时感知与监测系统', port: 8101, backendPort: 8201, receiverPort: 8301 },
  adaptive: { name: '运行监测数据自适应压缩传输控制决策与优化系统', port: 8102, backendPort: 8202, receiverPort: 8302 },
  prediction: { name: '工业网络数据传输智能诊断与预测系统', port: 8103, backendPort: 8203, receiverPort: 8303 }
}
export function softwareConfig(kind) {
  if (!Object.hasOwn(softwareConfigs, kind)) throw new Error('Specify monitor, adaptive or prediction')
  return softwareConfigs[kind]
}
