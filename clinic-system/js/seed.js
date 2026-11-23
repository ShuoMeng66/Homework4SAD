/* ============================================================
 * seed.js — 系统角色权限矩阵与标准业务枚举（严格依据分析与设计报告）
 * 数据完全存储于服务端 25 表关系型 SQLite 数据库，前端不保留本地种子库
 * ============================================================ */
(function () {
  const ROLE_LABEL = {
    receptionist: '前台接待',
    doctor: '口腔医生',
    cashier: '收费员',
    manager: '诊所负责人',
    admin: '系统管理员',
    patient: '患者',
  };

  // 严格按报告表 4、图 5、表 8~14 划分角色模块边界
  const ROLE_MODULES = {
    receptionist: ['dashboard', 'patients', 'schedule', 'appointments', 'recall', 'orders', 'reports'],
    doctor:       ['dashboard', 'patients', 'appointments', 'encounters', 'plans', 'orders'],
    cashier:      ['dashboard', 'billing'],
    manager:      ['dashboard', 'reports', 'recall', 'orders', 'basic'],
    admin:        ['dashboard', 'basic', 'patients', 'schedule', 'appointments', 'recall', 'encounters', 'plans', 'billing', 'orders', 'reports'],
    patient:      ['appointments', 'treatment', 'billing'],
  };

  const ENUM = {
    appointmentStage: ['待确认', '已确认', '已到诊', '已完成', '已取消', '爽约'],
    payStatus:        ['成功', '失败', '待确认', '退款'],
    orderStage:       ['草稿', '已发送', '已接收', '试戴', '质量确认', '已交货', '返工', '取消'],
    scheduleStage:    ['正常', '停诊'],
    recallStage:      ['待通知', '已通知', '已预约', '已关闭'],
    planStage:        ['拟定', '已确认', '执行中', '已完成', '已终止'],
    optionKinds:      ['岗位', '支付方式', '通知渠道', '附件类型', '订单类型', '颜色', '盒子颜色', '单位'],
  };

  window.SEED = { ROLE_LABEL, ROLE_MODULES, ENUM };
})();
