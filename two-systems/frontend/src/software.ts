export const software = import.meta.env.VITE_SOFTWARE === 'prediction' ? 'prediction' : 'adaptive'
export const softwareTitle = software === 'prediction'
  ? '基于时序特征的网络传输速率智能预测软件'
  : '自适应数据压缩策略分析与优化软件'
