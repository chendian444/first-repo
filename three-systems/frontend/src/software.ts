export const software = import.meta.env.VITE_SOFTWARE === 'monitor' ? 'monitor'
  : import.meta.env.VITE_SOFTWARE === 'prediction' ? 'prediction' : 'adaptive'
export const softwareTitle = {
  monitor: '工业网络传输状态实时感知与监测系统',
  adaptive: '运行监测数据自适应压缩传输控制决策与优化系统',
  prediction: '工业网络数据传输智能诊断与预测系统'
}[software]
