export const MATERIALS = [
  { id: 0, name: '玄武岩', en: 'Basalt', group: 'solids', color: '#63736f', temp: 90, rest: 2.45, viscosity: .16, copy: '沉静而坚实。冷却的熔岩化为岩石，受热后又会重新流动。' },
  { id: 1, name: '熔岩', en: 'Lava', group: 'liquids', color: '#f18b39', temp: 1250, rest: 2.2, viscosity: .12, copy: '炽热、黏稠、缓慢流动。与水相遇时，将热量传递给它。' },
  { id: 2, name: '水', en: 'Water', group: 'liquids', color: '#5ca9c3', temp: 18, rest: 2.1, viscosity: .025, copy: '随引力流动，在缝隙里聚集。加热到沸点后会化作蒸汽。' },
  { id: 3, name: '蒸汽', en: 'Steam', group: 'gases', color: '#c1d5d9', temp: 130, rest: 1, viscosity: .002, copy: '轻盈而自由，沿引力的反方向扩散。冷却后凝结为水。' },
  { id: 4, name: '冰', en: 'Ice', group: 'solids', color: '#bddcdd', temp: -12, rest: 2.15, viscosity: .2, copy: '一小片寒冷。吸收周围的热量，融化为流动的水。' },
  { id: 5, name: '铁', en: 'Iron', group: 'solids', color: '#9d9690', temp: 65, rest: 2.6, viscosity: .18, copy: '高密度、高导热的金属。连接为固体，达到熔点并吸收潜热后熔化。' },
  { id: 6, name: '沙', en: 'Sand', group: 'solids', color: '#c7af7e', temp: 22, rest: 2.3, viscosity: .06, copy: '细碎的金色颗粒。在重力下堆积，也可以被搅散、抛出。' },
];
MATERIALS.push(
  { id: 7, name: '钢架', en: 'Steel', group: 'structures', color: '#9fb9bf', temp: 20, viscosity: .15, copy: '三角支撑抵抗变形，可固定节点、剪断连接。' },
  { id: 8, name: '橡胶', en: 'Rubber', group: 'structures', color: '#d38c81', temp: 20, viscosity: .15, copy: '柔软的弹性网格，受力伸长，卸载后回弹。' },
  { id: 9, name: '绳索', en: 'Rope', group: 'structures', color: '#d6bd83', temp: 20, viscosity: .1, copy: '只能承受拉力的链条。可以弯曲、悬挂和剪断。' },
  { id: 10, name: '铁水', en: 'Molten iron', group: 'liquids', color: '#ffb05e', temp: 1650, viscosity: .09, copy: '铁熔化后的液态。冷却释放潜热，再凝固成铁。' },
  { id: 11, name: 'MPM 软体', en: 'Elastic solid', group: 'structures', color: '#b69bf0', temp: 20, viscosity: .03, mpm:true, copy: '可拉伸、压缩和弯曲的连续弹性体。拖动创建矩形，再用拖拽工具施力；松手后回弹。暂不模拟熔化或断裂。' },
);
// Reference constants, not temperature-dependent equations of state. Density kg/m³,
// specific heat J/(kg·K), conductivity W/(m·K). New parcels represent 1 litre.
const properties = [
  [2900,840,1.7,true], [2700,1200,1.5,false], [1000,4180,.6,false],
  [.6,2010,.025,false], [917,2100,2.2,true], [7870,450,80,true],
  [1600,830,.27,false], [7850,450,50,true], [1100,1800,.13,true],
  [700,1400,.12,true], [7000,820,30,false],
  [1100,1800,.13,true],
];
MATERIALS.forEach((m,i) => {
  [m.density,m.cp,m.conductivity,m.solid] = properties[i];
  m.rest = 2.1;
  m.compliance = i === 8 ? .0015 : i === 9 ? .00002 : .0000003;
  m.breakStrain = i === 8 ? 2.5 : i === 9 ? .8 : .65;
});
export const TOOLS = {
  draw: { name: '绘制结构', key: 'D', hint: '拖动绘制 · MPM 软体用块体，绳索用链条' },
  anchor: { name: '固定节点', key: 'A', hint: '涂过节点，将它们固定在当前位置' },
  release: { name: '释放节点', key: 'F', hint: '涂过已固定节点，恢复自由运动' },
  cut: { name: '剪断连接', key: 'X', hint: '涂过连接线，剪开固体或弹性结构' },
  emit: { name: '喷射材料', key: '1', hint: '按住左键喷射 · 右键擦除' },
  erase: { name: '删除粒子', key: '2', hint: '按住鼠标，擦除范围内粒子' },
  drag: { name: '拖拽粒子', key: '3', hint: '按住一片粒子，拖向新的位置' },
  attract: { name: '吸引粒子', key: '4', hint: '按住鼠标，将物质拉向笔尖' },
  repel: { name: '排斥粒子', key: '5', hint: '按住鼠标，将周围物质推开' },
  spin: { name: '旋转粒子', key: '6', hint: '按住左键旋转 · Shift 反转' },
  heat: { name: '加热', key: '7', hint: '为笔刷范围内的材料加热' },
  cool: { name: '冷却', key: '8', hint: '降低笔刷范围内材料的温度' },
  pan: { name: '移动视角', key: '9', hint: '拖动平移 · 滚轮缩放' },
};
