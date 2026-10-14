export const software = import.meta.env.VITE_SOFTWARE === 'monitor' ? 'monitor'
  : import.meta.env.VITE_SOFTWARE === 'prediction' ? 'prediction' : 'adaptive'
export const softwareTitle = {
  monitor: '多源网络传输状态实时监测软件',
  adaptive: '自适应数据压缩策略分析与优化软件',
  prediction: '基于时序特征的网络传输速率智能预测软件'
}[software]
